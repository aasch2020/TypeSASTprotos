import * as ts from "typescript";
import MagicString from "magic-string";
import { readFile, writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
import { readRoleConfig } from "./config";

// GPT SLOP
/**
 * transform modifies .ts files in-place under root (staging directory), emitting sourcemaps.
 * Returns a map from transformed file path -> raw source map object.
 *
 * Caller must create the TypeScript Program after this transform (use the project's tsconfig).
 */
export async function transform(root: string): Promise<Map<string, any>> {
	const roleConfig = await readRoleConfig(`${root}/roles.ds`); // must exist in your environment
	const knownRoles = new Set(Object.keys(roleConfig.roles || {}));

	// read tsconfig to get file list (do not create a Program here)
	const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic(diag) {
			console.error("tsconfig parse error:", ts.flattenDiagnosticMessageText(diag.messageText, "\n"));
		}
	});
	if (!parsed) throw new Error("Failed to parse tsconfig.json");

	// Build roles.generated.ts content and write it. Overwrite if exists.
	const graphEntries = Object.keys(roleConfig.roles || {}).map(role => {
		const arr = (roleConfig.roles[role].subsumes || []).map(a => `"${a}"`).join(", ");
		return `  "${role}": [${arr}]`;
	}).join(",\n");
	const rolesGenerated = `
export type _TYSAST_GRAPH = {
  ${graphEntries}
};

export type _TYSAST_ROLE = keyof _TYSAST_GRAPH;

declare const _TYSAST_BRAND: unique symbol;
type _TO_TYSAST_BRAND<K> = { readonly [_TYSAST_BRAND]: K };
export type _TYSAST_ROLE_TOKEN<R extends _TYSAST_ROLE> = _TO_TYSAST_BRAND<R> & { readonly role: R };
export function _TYSAST_MAKE_ROLE<R extends _TYSAST_ROLE>(r: R): _TYSAST_ROLE_TOKEN<R> { return { role: r } as _TYSAST_ROLE_TOKEN<R>; }

type _TYSAST_REACHABLE_FROM<Target extends _TYSAST_ROLE, Visited extends _TYSAST_ROLE = never> =
  Target extends Visited ? never :
  Target | (_TYSAST_GRAPH[Target] extends readonly (infer Ns)[] 
        ? (Ns extends _TYSAST_ROLE ? _TYSAST_REACHABLE_FROM<Ns, Visited | Target> : never) 
        : never);

export type _TYSAST_CAN_ELEVATE<From extends _TYSAST_ROLE, To extends _TYSAST_ROLE> = To extends _TYSAST_REACHABLE_FROM<From> ? true : false;

export function requireRole<From extends _TYSAST_ROLE, To extends _TYSAST_ROLE>(
  _current: _TYSAST_ROLE_TOKEN<From>,
  target: _TYSAST_CAN_ELEVATE<From, To> extends true ? To : never
) {
  return _TYSAST_MAKE_ROLE(target);
};
export const _TYSAST_DEFAULT_ROLE: _TYSAST_ROLE = ${JSON.stringify(roleConfig.defaultRole)};
`;
	console.log("USING:", rolesGenerated);
	const rolesPath = join(root, "roles.generated.ts");
	await writeFile(rolesPath, rolesGenerated, "utf8");

	// files to transform: use parsed.fileNames but filter out .d.ts and roles.generated.ts
	const fileNames = (parsed.fileNames || []).filter(p => p.endsWith(".ts") && !p.endsWith(".d.ts") && basename(p) !== "roles.generated.ts");

	const resultMaps = new Map<string, any>();

	// Build a simple name->declaration index for function and method declarations to enable conservative call-site rewrites.
	// We'll scan all files first to collect declarations and their requiredRole metadata.
	type DeclInfo = { filePath: string, node: ts.Node, requiredRole?: string };
	const declsByName = new Map<string, DeclInfo[]>();

	for (const filePath of fileNames) {
		const src = await readFile(filePath, "utf8");
		const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ESNext, true);
		function collect(node: ts.Node) {
			if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
				const jsTags = ts.getJSDocTags(node);
				const req = jsTags.find(t => t.tagName && t.tagName.getText() === "requiresRole");
				const requiredRole = req ? (req.comment ? String(req.comment).trim() : undefined) : undefined;
				declsByName.set(node.name.text, (declsByName.get(node.name.text) || []).concat([{ filePath, node, requiredRole }]));
			}
			if (ts.isClassDeclaration(node) && node.members) {
				const className = node.name ? node.name.text : undefined;
				for (const mem of node.members) {
					if ((ts.isMethodDeclaration(mem) || ts.isMethodSignature(mem)) && mem.name && ts.isIdentifier(mem.name) && className) {
						const methodKey = `${className}.${mem.name.text}`;
						const jsTags = ts.getJSDocTags(mem);
						const req = jsTags.find(t => t.tagName && t.tagName.getText() === "requiresRole");
						const requiredRole = req ? (req.comment ? String(req.comment).trim() : undefined) : undefined;
						declsByName.set(methodKey, (declsByName.get(methodKey) || []).concat([{ filePath, node: mem, requiredRole }]));
					}
				}
			}
			ts.forEachChild(node, collect);
		}
		collect(sf);
	}

	// Transform each file with MagicString
	for (const filePath of fileNames) {
		const src = await readFile(filePath, "utf8");
		const ms = new MagicString(src);
		const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ESNext, true);

		// ensure roles import exists; if not present add import at top
		if (!/from\s+['"]\.\/roles\.generated['"]/.test(src) && !/from\s+['"]roles\.generated['"]/.test(src)) {
			ms.prepend(`import { _TYSAST_ROLE_TOKEN, _TYSAST_MAKE_ROLE, requireRole, _TYSAST_DEFAULT_ROLE, _TYSAST_ROLE } from "./roles.generated";\n`);
		}

		// Collect function/method declarations in this file for local changes
		const localFnNodes: Array<{ node: ts.FunctionLikeDeclarationBase, requiredRole?: string, becomesRole?: string }> = [];

		function collectTransforms(node: ts.Node) {
			if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))) {
				// skip anonymous arrow functions not assigned to a name (we cannot reliably transform those)
				const jsTags = ts.getJSDocTags(node);
				const reqTag = jsTags.find(t => t.tagName && t.tagName.getText() === "requiresRole");
				const becomesTag = jsTags.find(t => t.tagName && t.tagName.getText() === "becomesRole");
				const requiredRole = reqTag ? (reqTag.comment ? String(reqTag.comment).trim() : undefined) : undefined;
				const becomesRole = becomesTag ? (becomesTag.comment ? String(becomesTag.comment).trim() : undefined) : undefined;

				if (requiredRole && !knownRoles.has(requiredRole)) {
					throw new Error(`Role "${requiredRole}" used in ${filePath} but not present in roleConfig`);
				}
				if (becomesRole && !knownRoles.has(becomesRole)) {
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
						? `roleContext: _TYSAST_ROLE_TOKEN<"${requiredRole}">`
						: `roleContext: _TYSAST_ROLE_TOKEN<_TYSAST_ROLE> = _TYSAST_MAKE_ROLE(_TYSAST_DEFAULT_ROLE as _TYSAST_ROLE)`;
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
						ms.appendLeft(body.getStart(), `: _TYSAST_ROLE_TOKEN<"${becomesRole}"> `);

						// replace trivial return expressions inside the body
						function replaceReturns(n: ts.Node) {
							if (ts.isReturnStatement(n)) {
								if (n.expression) {
									const exprText = n.expression.getFullText(sf).trim();
									if (exprText === "true" || exprText === "false" || exprText === "null" || exprText === "undefined") {
										ms.overwrite(n.expression.getStart(), n.expression.getEnd(), `_TYSAST_MAKE_ROLE("${becomesRole}")`);
									}
								} else {
									// bare return -> replace whole return
									ms.overwrite(n.getStart(), n.getEnd(), `return _TYSAST_MAKE_ROLE("${becomesRole}");`);
								}
							}
							ts.forEachChild(n, replaceReturns);
						}
						replaceReturns(body);

						// if no return found, append one before closing brace
						if (!/return\b/.test(body.getFullText(sf))) {
							ms.appendLeft(body.getEnd() - 1, `\n  return _TYSAST_MAKE_ROLE("${becomesRole}");\n`);
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
						if (!knownRoles.has(requiredRole)) {
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
								if (!knownRoles.has(requiredRole)) throw new Error(`Role "${requiredRole}" referenced in call-site but not present in roleConfig`);
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
						if (!knownRoles.has(raised)) throw new Error(`Role "${raised}" used in @raised comment in ${filePath} but not present in roleConfig`);
						// insert const declaration before this statement
						const declText = `const roleContextRaised: _TYSAST_ROLE_TOKEN<"${raised}"> = _TYSAST_MAKE_ROLE("${raised}");\n`;
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