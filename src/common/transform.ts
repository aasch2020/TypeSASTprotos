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
	If: "if"
};

const RoleVar = "_TYPESAST_ROLE_CTX";

export async function transform(root: string): Promise<Map<string, any>> {
	const roleConfig = {
		roles: {
			"admin": { subsumes: ["user", "unauth"] },
			"user": { subsumes: ["unauth"] },
			"unauth": { subsumes: [] }
		},
		defaultRole: "unsec"
	};//await readRoleConfig(`${root}/roles.ds`);
	const existingRoles = new Set(Object.keys(roleConfig.roles));

	const project = new Project({
		tsConfigFilePath: join(root, "tsconfig.json")
	});
	const tc = project.getTypeChecker();

	const roleGraph = Object.fromEntries(Object.entries(roleConfig.roles).map(([role, { subsumes }]) => [role, subsumes]));
	const rolesGenerated = `export type ${TypeSast.Graph} = {${roleGraph}};export type ${TypeSast.Role} = keyof ${TypeSast.Graph};declare const _TYSAST_BRAND: unique symbol;type _TO_TYSAST_BRAND<K> = { readonly [_TYSAST_BRAND]: K };export type ${TypeSast.RoleToken}<R extends ${TypeSast.Role}> = _TO_TYSAST_BRAND<R> & { readonly role: R };export function ${TypeSast.MakeRole}<R extends ${TypeSast.Role}>(r: R): ${TypeSast.RoleToken}<R> { return { role: r } as ${TypeSast.RoleToken}<R>; }type _TYSAST_REACHABLE_FROM<Target extends ${TypeSast.Role}, Visited extends ${TypeSast.Role} = never> = Target extends Visited ? never : Target | (${TypeSast.Graph}[Target] extends readonly (infer Ns)[] ? (Ns extends ${TypeSast.Role} ? _TYSAST_REACHABLE_FROM<Ns, Visited | Target> : never) : never);export type _TYSAST_CAN_ELEVATE<From extends ${TypeSast.Role}, To extends ${TypeSast.Role}> = To extends _TYSAST_REACHABLE_FROM<From> ? true : false;export function ${TypeSast.RequireRole}<From extends ${TypeSast.Role}, To extends ${TypeSast.Role}>(_current: ${TypeSast.RoleToken}<From>,target: _TYSAST_CAN_ELEVATE<From, To> extends true ? To : never) {return ${TypeSast.MakeRole}(target);};export const ${TypeSast.Default}: ${TypeSast.Role} = ${JSON.stringify(roleConfig.defaultRole)};`;

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

	const transformed: Set<ts.Node> = new Set();

	for (const [sourceFile, ms] of files) {
		(function collect(node: Node) {
			if (Node.isFunctionLikeDeclaration(node)) {
				let requiredRole = roleConfig.defaultRole;
				for (const doc of node.getJsDocs()) {
					for (const t of doc.getTags()) {
						if (t.getTagName() === JsDoc.RequiresRole) {
							requiredRole = t.getCommentText()!.split(/[^\w]/)[0];
						}
					}
				}
				node.addParameter({
					name: RoleVar,
					type: `${TypeSast.RoleToken}<"${requiredRole}">`
				});
				transformed.add(node);
			}
			/*switch (node.getKind()) {
				case SyntaxKind.FunctionDeclaration:
				case SyntaxKind.MethodDeclaration: {
					const fn = node.asKind(SyntaxKind.FunctionDeclaration) ?? node.asKind(SyntaxKind.MethodDeclaration)!;


					transformed.add(fn);
					const openParen = node.getChildrenOfKind(SyntaxKind.OpenParenToken)[0];
					const syntaxList = node.getChildAtIndex(openParen.getChildIndex() + 1)?.asKind(SyntaxKind.SyntaxList)!;
					const lastParam = syntaxList?.getLastChildByKind(SyntaxKind.Parameter);
					ms.appendRight(lastParam?.getEnd() ?? openParen.getEnd(), `${lastParam ? ", " : ""}roleContext: ${TypeSast.RoleToken}<"${requiredRole}">`);
					break;
				}
				case ts.SyntaxKind.Constructor: {
					//console.log("Constructor:", node.getChildren().map(x => x.kind));
					break;
				}
				case ts.SyntaxKind.GetAccessor: {
					//console.log("GetAccessor:", node.getChildren().map(x => x.kind));
					break;
				}
				case ts.SyntaxKind.SetAccessor: {
					//console.log("SetAccessor:", node.getChildren().map(x => x.kind));
					break;
				}
				case ts.SyntaxKind.ArrowFunction:
				case ts.SyntaxKind.FunctionExpression: {
					// todo
				}
				case ts.SyntaxKind.FunctionType:
				case ts.SyntaxKind.ConstructorType:
					break;
				case ts.SyntaxKind.CallExpression: {
					const functionName = node.getChildrenOfKind(SyntaxKind.Identifier)[0];
					if (!functionName) break;
					const sym = tc.getSymbolAtLocation(functionName);
					if (!sym) break;
					const dec = sym.getValueDeclaration();
					if (!dec) break;
					if (!transformed.has(dec)) break;
					const openParen = node.getChildrenOfKind(SyntaxKind.OpenParenToken)[0];
					const syntaxList = node.getChildAtIndex(openParen.getChildIndex() + 1)?.asKind(SyntaxKind.SyntaxList)!;
					const lastParam = syntaxList?.getLastChildByKind(SyntaxKind.Parameter);
					ms.appendRight(lastParam?.getEnd() ?? openParen.getEnd(), `${lastParam ? ", " : ""}roleContext: ${TypeSast.RoleToken}<"${requiredRole}">`);
					//console.log("gamer:", node.getChildren().map(x => x.kind));
				}
			}*/
			node.forEachChild(collect);
		})(sourceFile);
		console.log(sourceFile.print());
	}
	throw "";

	for (const filePath of toTransform) {

		const localFnNodes: Array<{ node: ts.FunctionLikeDeclarationBase, requiredRole?: string, becomesRole?: string }> = [];

		function collectTransforms(node: ts.Node) {
			if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
				const jsTags = ts.getJSDocTags(node);
				const reqTag = jsTags.find(t => t.tagName && t.tagName.getText() === "requiresRole");
				const becomesTag = jsTags.find(t => t.tagName && t.tagName.getText() === "becomesRole");
				const requiredRole = reqTag ? (reqTag.comment ? String(reqTag.comment).trim() : undefined) : undefined;
				const becomesRole = becomesTag ? (becomesTag.comment ? String(becomesTag.comment).trim() : undefined) : undefined;

				if (requiredRole && !existingRoles.has(requiredRole)) {
					throw new Error(`Role "${requiredRole}" used in ${filePath} but not present in roleConfig`);
				}
				if (becomesRole && !existingRoles.has(becomesRole)) {
					throw new Error(`Role "${becomesRole}" used in ${filePath} but not present in roleConfig`);
				}

				// Only process top-level named functions and class methods and named function expressions
				const params = (node as any).parameters as ts.NodeArray<ts.ParameterDeclaration> | undefined;
				const hasRoleParam = params && params.some(p => ts.isIdentifier(p.name) && p.name.text === "roleContext");
				if (!hasRoleParam) {
					// insert parameter text just before the close-paren
					const closeParen = node.getChildren().find(ch => ch.kind === ts.SyntaxKind.CloseParenToken);
					const insertionPos = closeParen ? closeParen.getStart() : node.getEnd();
					const paramText = requiredRole
						? `roleContext: ${TypeSast.RoleToken}<"${requiredRole}">`
						: `roleContext: ${TypeSast.RoleToken}<${TypeSast.Role}> = ${TypeSast.MakeRole}(${TypeSast.Default})`;
					// if there are any parameters already, prepend ", "
					const hasParams = params && params.length > 0;
					const insertion = (hasParams ? `, ${paramText}` : paramText);
					ms.appendLeft(insertionPos, insertion);
				}

				if (becomesRole && (becomesRole.length > 0)) {
					// insert return type before body and replace simple returns
					const body = (node as any).body as ts.Block | undefined;
					if (body) {
						// place return type annotation right before body
						ms.appendLeft(body.getStart(), `: ${TypeSast.RoleToken}<"${becomesRole}"> `);

						// replace trivial return expressions inside the body
						function replaceReturns(n: ts.Node) {
							if (ts.isReturnStatement(n)) {
								if (n.expression) {
									const exprText = n.expression.getFullText(sf).trim();
									if (exprText === "true" || exprText === "false" || exprText === "null" || exprText === "undefined") {
										ms.overwrite(n.expression.getStart(), n.expression.getEnd(), `${TypeSast.MakeRole}("${becomesRole}")`);
									}
								} else {
									// bare return -> replace whole return
									ms.overwrite(n.getStart(), n.getEnd(), `return ${TypeSast.MakeRole}("${becomesRole}");`);
								}
							}
							ts.forEachChild(n, replaceReturns);
						}
						replaceReturns(body);

						// if no return found, append one before closing brace
						if (!/return\b/.test(body.getFullText(sf))) {
							ms.appendLeft(body.getEnd() - 1, `\n  return ${TypeSast.MakeRole}("${becomesRole}");\n`);
						}
					}
				}

				localFnNodes.push({ node: node as ts.FunctionLikeDeclarationBase, requiredRole, becomesRole });
			}
			ts.forEachChild(node, collectTransforms);
		}
		collectTransforms(sf);

		// Helper: find single-line leading comments like "// @raised ROLE" associated with an expression statement
		function getRaisedRoleForStatement(stmt: ts.Statement): string | undefined {
			const leadingRanges = ts.getLeadingCommentRanges(src, stmt.getFullStart()) || [];
			if (leadingRanges.length === 0) return undefined;
			// consider last leading comment only (closest)
			const last = leadingRanges[leadingRanges.length - 1];
			const txt = src.slice(last.pos, last.end);
			// normalize: remove comment markers
			const cleaned = txt.replace(/^\/\//, "").replace(/^\/\*\s*/, "").replace(/\*\/$/, "").trim();
			const m = cleaned.match(/^@raised\s+([A-Za-z0-9_]+)/);
			if (m) return m[1];
			return undefined;
		}

		// Second pass: call-site rewriting (conservative). For call expressions whose callee is an Identifier
		// and matches a known declaration that has @requiresRole, append requireRole(roleContext, "X").
		function visitCalls(node: ts.Node) {
			if (ts.isCallExpression(node)) {
				// Skip if arg already contains roleContext or requireRole
				const argsText = node.arguments.map(a => a.getFullText(sf)).join("\n");
				if (argsText.includes("roleContext") || argsText.includes("requireRole(")) {
					return;
				}
				// callee as identifier
				if (ts.isIdentifier(node.expression)) {
					const name = node.expression.text;
					const decls = declsByName.get(name) || [];
					// pick a decl in same project with a @requiresRole tag
					const useful = decls.find(d => {
						if (!d) return false;
						const tags = ts.getJSDocTags(d.node as any);
						const req = tags.find(t => t.tagName && t.tagName.getText() === "requiresRole");
						return !!req;
					});
					if (useful) {
						const req = ts.getJSDocTags(useful.node as any).find(t => t.tagName && t.tagName.getText() === "requiresRole");
						const requiredRole = req ? (req.comment ? String(req.comment).trim() : undefined) : undefined;
						if (!requiredRole) return;
						if (!existingRoles.has(requiredRole)) {
							throw new Error(`Role "${requiredRole}" referenced in call-site but not present in roleConfig`);
						}
						// insert before closing ')'
						const insertion = (node.arguments.length > 0 ? `, requireRole(roleContext, "${requiredRole}")` : `requireRole(roleContext, "${requiredRole}")`);
						// node.getEnd() is position after ')', so subtract 1 to insert before ')'
						ms.appendLeft(node.getEnd() - 1, insertion);
					}
				}

				// handle property access callee case with ClassName.method simple pattern: obj.method()
				// attempt to match by method name only: if there exists any decl with method name and @requiresRole, apply a best-effort injection.
				if (ts.isPropertyAccessExpression(node.expression)) {
					const methodName = node.expression.name.text;
					// search decls by method short name (e.g., ClassName.method registered as ClassName.method)
					// first try any decl with .methodName key
					for (const [key, decls] of declsByName.entries()) {
						if (key.endsWith("." + methodName)) {
							const useful = decls.find(d => {
								const tags = ts.getJSDocTags(d.node as any);
								return tags.some(t => t.tagName && t.tagName.getText() === "requiresRole");
							});
							if (useful) {
								const req = ts.getJSDocTags(useful.node as any).find(t => t.tagName && t.tagName.getText() === "requiresRole");
								const requiredRole = req ? (req.comment ? String(req.comment).trim() : undefined) : undefined;
								if (!requiredRole) continue;
								if (!existingRoles.has(requiredRole)) throw new Error(`Role "${requiredRole}" referenced in call-site but not present in roleConfig`);
								if (!argsText.includes("roleContext") && !argsText.includes("requireRole(")) {
									const insertion = (node.arguments.length > 0 ? `, requireRole(roleContext, "${requiredRole}")` : `requireRole(roleContext, "${requiredRole}")`);
									ms.appendLeft(node.getEnd() - 1, insertion);
								}
								break;
							}
						}
					}
				}
			}
			ts.forEachChild(node, visitCalls);
		}
		visitCalls(sf);

		// Third pass: implement // @raised ROLE handling. Look for ExpressionStatements that are CallExpressions
		// and have a single-line leading comment matching @raised ROLE. Insert a const and replace the requireRole argument.
		function visitStatements(node: ts.Node) {
			const isExprStmt = ts.isExpressionStatement(node);
			const isRetStmt = ts.isReturnStatement(node);
			if (isExprStmt || isRetStmt) {
				const expr = isExprStmt
					? (node as ts.ExpressionStatement).expression
					: (node as ts.ReturnStatement).expression;
				if (expr && ts.isCallExpression(expr)) {
					const raised = getRaisedRoleForStatement(node as ts.Statement);
					if (raised) {
						if (!existingRoles.has(raised)) throw new Error(`Role "${raised}" used in @raised comment in ${filePath} but not present in roleConfig`);
						// insert const declaration before this statement
						const declText = `const roleContextRaised: ${TypeSast.RoleToken}<"${raised}"> = ${TypeSast.MakeRole}("${raised}");\n`;
						ms.appendLeft(node.getStart(), declText);
						// alter the call: find the argument that is a call to requireRole and replace it
						const args = expr.arguments;
						let replaced = false;
						for (let i = 0; i < args.length; i++) {
							const arg = args[i];
							// Check if the argument is a call to requireRole
							if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'requireRole') {
								// replace this argument with roleContextRaised
								ms.overwrite(arg.getStart(), arg.getEnd(), 'roleContextRaised');
								replaced = true;
								break;
							}
						}
						// If no requireRole call found, fall back to replacing the last argument (the injected roleContext)
						if (!replaced && args.length > 0) {
							ms.overwrite(args[args.length - 1].getStart(), args[args.length - 1].getEnd(), 'roleContextRaised');
						}
					}
				}
			}
			ts.forEachChild(node, visitStatements);
		}
		visitStatements(sf);

		// At this point all edits are in MagicString. Emit file and source map.
		const transformed = ms.toString();
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

		// store raw map JSON
		resultMaps.set(filePath, JSON.parse(map.toString()));
	}

	return resultMaps;
}

transform("F:\\Desktop\\TypeSASTprotos\\examples\\unsec");