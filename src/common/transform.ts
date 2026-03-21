//import * as ts from "typescript";
import * as ts from "ts-morph";
import { Project, Node, SyntaxKind } from "ts-morph";
import MagicString from "magic-string";
import { readFile, writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
//import { readRoleConfig } from "./config";

const TypeSast = {
	Role: "_TYSAST_ROLE",
	Graph: "_TYSAST_GRAPH",
	MakeRole: "_TYSAST_MAKE_ROLE",
	RequireRole: "_TYSAST_REQUIRE_ROLE",
	Default: "_TYSAST_DEFAULT_ROLE",
	RoleToken: "_TYSAST_ROLE_TOKEN"
};

const JsDoc = {
	RequiresRole: "requiresRole",
	BecomesRole: "becomesRole",
	If: "ifReturns"
};

const RoleVar = "_TYPESAST_ROLE_CTX";

function uniq(tc: ts.TypeChecker, node: Node, base: string) {
	let i = 0;

	while (true) {
		const name = i === 0 ? base : `${base}_${i.toString(16)}`;
		const symbols = tc.getSymbolsInScope(node, ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace);

		if (!symbols.some(s => s.getName() === name)) {
			return name;
		}
		i++;
	}
}

type ValueExit =
	| { kind: "return"; node: ts.ReturnStatement }
	| { kind: "yield"; node: ts.YieldExpression }
	| { kind: "expression-body"; node: Node }
	| { kind: "implicit-end"; node: Node };

function getAllValueExits(fn: ts.Node): ValueExit[] | void {
	if (!Node.isFunctionLikeDeclaration(fn)) return;
	const exits: ValueExit[] = [];

	const body = (() => {
		switch (fn.getKind()) {
			case SyntaxKind.ArrowFunction:
				return fn.asKind(SyntaxKind.ArrowFunction)!.getBody();
			case SyntaxKind.FunctionDeclaration:
				return fn.asKind(SyntaxKind.FunctionDeclaration)!.getBody();
			case SyntaxKind.MethodDeclaration:
				return fn.asKind(SyntaxKind.MethodDeclaration)!.getBody();
			case SyntaxKind.GetAccessor:
				return fn.asKind(SyntaxKind.GetAccessor)!.getBody();
			case SyntaxKind.SetAccessor:
				return fn.asKind(SyntaxKind.SetAccessor)!.getBody();
			case SyntaxKind.Constructor:
				return fn.asKind(SyntaxKind.Constructor)!.getBody();
			case SyntaxKind.FunctionExpression:
				return fn.asKind(SyntaxKind.FunctionExpression)!.getBody();
			case SyntaxKind.ArrowFunction:
				return fn.asKind(SyntaxKind.ArrowFunction)!.getBody();
		}
	})()!;
	if (!body) return exits;

	if (Node.isArrowFunction(fn) && !Node.isBlock(body)) {
		exits.push({ kind: "expression-body", node: body });
		return exits;
	}

	body.forEachDescendant((node, traversal) => {
		if (node !== fn && Node.isFunctionLikeDeclaration(node)) {
			traversal.skip();
			return;
		}

		if (Node.isReturnStatement(node)) {
			exits.push({ kind: "return", node });
			return;
		}

		if (Node.isYieldExpression(node)) {
			exits.push({ kind: "yield", node });
			return;
		}
	});

	exits.push({ kind: "implicit-end", node: body });
	return exits;
}

export async function transform(root: string): Promise<Map<string, any>> {
	const roleConfig = {
		roles: {
			"admin": { subsumes: ["user", "unauth"] },
			"user": { subsumes: ["unauth"] },
			"unauth": { subsumes: [] }
		},
		defaultRole: "unauth"
	};//await readRoleConfig(`${root}/roles.ds`);
	const existingRoles = new Set(Object.keys(roleConfig.roles));

	const project = new Project({
		tsConfigFilePath: join(root, "tsconfig.json")
	});
	const tc = project.getTypeChecker();

	const roleGraph = Object.fromEntries(Object.entries(roleConfig.roles).map(([role, { subsumes }]) => [role, subsumes]));
	const rolesGenerated = `export type ${TypeSast.Graph} = ${JSON.stringify(roleGraph)};export type ${TypeSast.Role} = keyof ${TypeSast.Graph};declare const _TYSAST_BRAND: unique symbol;type _TO_TYSAST_BRAND<K> = { readonly [_TYSAST_BRAND]: K };export type ${TypeSast.RoleToken}<R extends ${TypeSast.Role}> = _TO_TYSAST_BRAND<R> & { readonly role: R };export function ${TypeSast.MakeRole}<R extends ${TypeSast.Role}>(r: R): ${TypeSast.RoleToken}<R> { return { role: r } as ${TypeSast.RoleToken}<R>; }type _TYSAST_REACHABLE_FROM<Target extends ${TypeSast.Role}, Visited extends ${TypeSast.Role} = never> = Target extends Visited ? never : Target | (${TypeSast.Graph}[Target] extends readonly (infer Ns)[] ? (Ns extends ${TypeSast.Role} ? _TYSAST_REACHABLE_FROM<Ns, Visited | Target> : never) : never);export type _TYSAST_CAN_ELEVATE<From extends ${TypeSast.Role}, To extends ${TypeSast.Role}> = To extends _TYSAST_REACHABLE_FROM<From> ? true : false;export function ${TypeSast.RequireRole}<From extends ${TypeSast.Role}, To extends ${TypeSast.Role}>(_current: ${TypeSast.RoleToken}<From>,target: _TYSAST_CAN_ELEVATE<From, To> extends true ? To : never) {return ${TypeSast.MakeRole}(target);};export const ${TypeSast.Default}: ${TypeSast.Role} = ${JSON.stringify(roleConfig.defaultRole)};`;

	const rolesPath = join(root, "roles.generated.ts");
	//await writeFile(rolesPath, rolesGenerated, "utf8");

	const resultMaps = new Map<string, any>();

	const files = await Promise.all(project.getSourceFiles().map(async file => {
		const src = await readFile(file.getFilePath(), "utf8");
		const ms = new MagicString(src);
		return [file, ms] as const;
	}));

	for (const [_, ms] of files) {
		ms.prepend(`import { ${TypeSast.RoleToken}, ${TypeSast.MakeRole}, ${TypeSast.RequireRole}, ${TypeSast.Default}, ${TypeSast.Role} } from "./roles.generated";\n`);
	}

	const transformed: Map<ts.Node, { becomes: string, ifReturns: string }> = new Map();

	for (const [sourceFile, ms] of files) {
		(function addRequiresRole(node: Node) {
			if (Node.isFunctionLikeDeclaration(node)) {
				node.removeReturnType();

				let requiredRole = roleConfig.defaultRole;
				let becomesRole;
				let ifReturns;
				for (const doc of node.getJsDocs()) {
					for (const t of doc.getTags()) {
						switch (t.getTagName()) {
							case JsDoc.RequiresRole:
								requiredRole = t.getCommentText()!.split(/[^\w]/)[0];
								break;
							case JsDoc.BecomesRole:
								becomesRole = t.getCommentText()!.split(/[^\w]/)[0];
								break;
							case JsDoc.If:
								ifReturns = t.getCommentText();
								break;
						}
					}
				}

				node.addParameter({
					name: RoleVar,
					type: `${TypeSast.RoleToken}<"${requiredRole}">`
				});
				if (becomesRole) {
					for (const { kind, node: retNode } of getAllValueExits(node)!) {
						switch (kind) {
							case "return": {
								const oldRet = retNode.getText();
								retNode.replaceWithText(`return [(()=>{${oldRet}})(), ${TypeSast.MakeRole}("${becomesRole}")] as const;`);
								break;
							}
							case "implicit-end": {
								const block = retNode.asKind(SyntaxKind.Block)!;
								block.addStatements(`return [(()=>{})(), ${TypeSast.MakeRole}("${becomesRole}")] as const;`);
								break;
							}
							case "expression-body": {
								const oldRet = retNode.getText();
								retNode.replaceWithText(`[(${oldRet}), ${TypeSast.MakeRole}("${becomesRole}")] as const`)
								break;
							}
							case "yield":
								// Don't support this case, generator functions are gross
								throw "crap idiot";
						}
					}
				}
				transformed.set(node, {
					becomes: becomesRole || "",
					ifReturns: ifReturns || ""
				});
				return;
			}
			node.forEachChild(addRequiresRole);
		})(sourceFile);

		// Add the role var to functions that require it
		(function addRoleVarToCallSites(node: Node) {
			if (Node.isCallExpression(node)) {
				const identifier = node.getChildAtIndex(0);
				const sym = tc.getSymbolAtLocation(identifier);
				const dec = sym?.getValueDeclaration();
				if (dec) {
					if (transformed.has(dec)) {
						if (tc.resolveName(RoleVar, node, ts.SymbolFlags.Value, false)) {
							node.addArgument(RoleVar);
						} else {
							node.addArgument(TypeSast.Default);
						}
						const { becomes, ifReturns } = transformed.get(dec)!;
						if (becomes) {
							const nodeText = node.getText();
							const actualReturn = uniq(tc, node, "ret");
							const secType = uniq(tc, node, "secType");
							node.replaceWithText(`(()=>{const [${actualReturn},${secType}] = (${nodeText});if(${ifReturns ? `${ifReturns} === ${actualReturn}` : "true"}){${RoleVar} = ${secType};}return ${actualReturn};})()`);
						}
						return;
					}
				}
			}
			node.forEachChild(addRoleVarToCallSites);
		})(sourceFile);
		console.log(rolesGenerated + sourceFile.print());
	}
	throw "";

	const map = ms.generateMap({
		file: basename(filePath),
		source: basename(filePath),
		includeContent: true,
		hires: true
	});

	// write transformed file with sourceMappingURL
	const mapFileName = basename(filePath) + ".map";
	const transformedWithMapComment = transformed + `\n//# sourceMappingURL=${mapFileName}\n`;
	await writeFile(filePath, transformedWithMapComment, "utf8");
	const mapPath = join(dirname(filePath), mapFileName);
	await writeFile(mapPath, map.toString(), "utf8");

	resultMaps.set(filePath, JSON.parse(map.toString()));

	return resultMaps;
}

transform("F:\\Desktop\\TypeSASTprotos\\examples\\unsec");