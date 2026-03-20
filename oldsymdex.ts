import { CallExpression, FunctionDeclaration, JSDoc, MethodDeclaration, ParameterDeclaration, Project, Scope, ScriptTarget, SyntaxKind, ts, VariableDeclarationKind } from "ts-morph";
import { cp } from "fs/promises";
import * as path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { buildCallIndex, reverseTrace, reverseTraceUntilRole } from "./src/bt"
export function makeSymexDriver(
    project: Project,
    funcName: string,
    tsFile: string,
    outFile: string
) {
    const sourceFile = project.addSourceFileAtPath(tsFile);

    const func = sourceFile.getFunction(funcName);
    if (!func) throw new Error(`Function ${funcName} not found in ${tsFile}`);
    console.log(funcName + "driver gen")

    const jsModule = "./" + path.basename(tsFile, ".ts");

    const lines: string[] = [];
    lines.push(`/* Generated symbolic driver for ${funcName} */`);
    lines.push(`var S$ = require("S$");`);
    lines.push(`var { state } = require("./state");`);
    lines.push(`var { ${funcName} } = require("${jsModule}");`);
    lines.push(`var out;`);

    function buildSymex(type: import("ts-morph").Type, path: string): string {
        if (type.isString()) return `S$.symbol("${path}", "")`;
        if (type.isNumber()) return `S$.symbol("${path}", 0)`;
        if (type.isBoolean()) return `S$.symbol("${path}", false)`;
        if (type.isObject()) {
            const props = type.getProperties();
            const fields = props.map(prop => {
                const decl = prop.getValueDeclaration();
                const propType = decl ? decl.getType() : prop.getDeclaredType();
                return `${prop.getName()}: ${buildSymex(propType, `${path}.${prop.getName()}`)}`;
            });
            return `{ ${fields.join(", ")} }`;
        }
        // fallback for unknown types
        return `S$.symbol("${path}", "")`;
    }

    const callArgs: string[] = [];

    for (const p of func.getParameters()) {
        const name = p.getName();
        const type = p.getType();
        lines.push(`var ${name} = ${buildSymex(type, name)};`);
        callArgs.push(name);
    }

    lines.push(`out = ${funcName}(${callArgs.join(", ")});`);
    lines.push(`console.log("Symbolic output:", out);`);

    const driverCode = `function verify() {\n  ${lines.join("\n  ")}\n}\nverify();\n`;

    fs.writeFileSync(outFile, driverCode, "utf-8");
    console.log(`Written symbolic driver to ${outFile}`);
}
function insertStateRaiseSimple(filePath: string) {
    let code = fs.readFileSync(filePath, "utf-8");

    // Match lines with @raised <role>
    const regex = /\/\*\*\s*@raised\s+([a-zA-Z0-9_-]+)\s*\*\//g;

    code = code.replace(regex, (x, role) => {
        console.log(x, role)
        // Replace the @raised comment with the state.raise call
        return `${x} \n void 0;`;
    });

    fs.writeFileSync(filePath, code);
}

function anchorhack(filePath: string) {
    let code = fs.readFileSync(filePath, "utf-8");

    // Match lines with @raised <role>
    const regex = /\/\*\*\s*@raised\s+([a-zA-Z0-9_-]+)\s*\*\//g;

    code = code.replace(regex, (x, role) => {
        console.log(x, role)
        // Replace the @raised comment with the state.raise call
        return `${x} \n void 0;`;
    });

    fs.writeFileSync(filePath, code);
}
function findJsDocWithRaised(project: Project) {
    type RaisedEntry = { node: import("ts-morph").Node; roleName: string };
    const out: RaisedEntry[] = [];

    for (const sf of project.getSourceFiles()) {
        sf.forEachDescendant((node) => {

            const getJsDocs = (node as {
                getJsDocs?: () => {
                    getTags: () => {
                        getTagName: () => string;
                        getComment: () => unknown;
                        getCommentText: () => string;
                    }[];
                }[];
            }).getJsDocs;

            if (typeof getJsDocs !== "function") return;

            const docs = getJsDocs.call(node);
            if (!docs?.length) return;

            const raisedTag = docs
                .flatMap(d => d.getTags())
                .find(t => t.getTagName() === "raised");

            if (!raisedTag) return;

            const raw = raisedTag.getComment();
            const roleName =
                (typeof raw === "string"
                    ? raw
                    : raisedTag.getCommentText() ?? ""
                ).trim();

            if (!roleName) return;
            const parent = node.getParent();

            // only insert inside blocks (functions, methods, etc.)
            if (parent && parent.getKindName() === "Block") {
                const block = parent.asKindOrThrow(SyntaxKind.Block);

                // find safe insertion point: first statement in block
                const stmts = block.getStatements();

            }

            out.push({ node, roleName });
        });
    }

    return out;
}
function makeForSymex(targetDir: string, roles: string[], entryPoints: string[], entryFiles: string[]) {
    const project = new Project({
        compilerOptions: {
            target: ScriptTarget.ES2024,
            module: 1, // ESNext
        },
    });


    const allFiles = project.addSourceFilesAtPaths(path.join(targetDir, "*.ts"));

    const stateFile = project.createSourceFile(
        path.join(targetDir, "state.ts"),
        "",
        { overwrite: true }
    );


    const cls = stateFile.addClass({
        name: "AnalysisState",
        properties: [
            {
                name: "currentRole",
                type: roles.map(r => `"${r}"`).join(" | "),
                initializer: `"${roles[0]}"`,
                scope: Scope.Public
            },
            {
                name: "raisedRole",
                type: roles.map(r => `"${r}"`).join(" | ") + " | null",
                initializer: "null",
                scope: Scope.Public
            }
        ],
        methods: [
            {
                name: "raise",
                parameters: [{ name: "role", type: roles.map(r => `"${r}"`).join(" | ") }],
                statements: [
                    "this.raisedRole = role;",
                    "this.currentRole = role;"
                ]
            }
        ]
    });

    for (const role of roles) {
        cls.addMethod({
            name: "set" + role[0].toUpperCase() + role.slice(1),
            statements: [`this.currentRole = "${role}";`]
        });
    }


    for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const allowedRoles = roles.slice(i);
        cls.addMethod({
            name: "require" + role[0].toUpperCase() + role.slice(1),
            returnType: "void",
            statements: [
                `if (![${allowedRoles.map(r => `"${r}"`).join(", ")}].includes(this.currentRole)) {`,
                `  throw new Error("Requires role ${role} or higher, current role is " + this.currentRole);`,
                `}`
            ]
        });
    }


    stateFile.addVariableStatement({
        declarationKind: VariableDeclarationKind.Const,
        isExported: true,
        declarations: [{ name: "state", initializer: "new AnalysisState()" }]
    });


    for (const file of allFiles) {
        // skip state.ts itself
        if (file.getBaseName() === "state.ts") continue;

        const hasImport = file.getImportDeclarations().some(id => id.getModuleSpecifierValue() === "./state");
        if (!hasImport) {
            console.log("Adding import to:", file.getBaseName());
            file.insertStatements(0, `import { state } from "./state";`);
        }
        file.saveSync();
    }


    for (const sourceFile of project.getSourceFiles()) {

        // Visit all functions and methods
        sourceFile.forEachDescendant((node) => {

            if (
                node.getKind() === SyntaxKind.FunctionDeclaration ||
                node.getKind() === SyntaxKind.MethodDeclaration
            ) {
                const fn = node.asKindOrThrow(
                    node.getKind() === SyntaxKind.FunctionDeclaration
                        ? SyntaxKind.FunctionDeclaration
                        : SyntaxKind.MethodDeclaration
                );

                // Check for @requiresRole annotation
                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "requiresRole");

                if (!requiresRoleTag) return; // nothing to do if no @requiresRole

                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string"
                    ? reqRaw.trim()
                    : requiresRoleTag.getCommentText()?.trim()) ?? "unauth";

                // Insert call to state.require<Role>() at the start of the function body
                let body = fn.getBodyText();
                fn.insertStatements(0, `state.require${roleType[0].toUpperCase() + roleType.slice(1)}();`)
                const becomesTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "becomesRole");

                if (becomesTag) {
                    const raw = becomesTag.getComment();
                    const becomesRole = (typeof raw === "string"
                        ? raw.trim()
                        : becomesTag.getCommentText()?.trim()) ?? "";

                    if (becomesRole) {
                        const references = fn.findReferencesAsNodes();

                        const callSites: CallExpression[] = [];

                        for (const reference of references) {
                            const callExpression = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);
                            if (!callExpression) continue;

                            const expr = callExpression.getExpression();
                            let isMatch = false;

                            if (expr.isKind(SyntaxKind.Identifier)) {
                                const refSymbol = reference.getSymbol();
                                const exprSymbol = expr.getSymbol();
                                if (refSymbol && exprSymbol && refSymbol === exprSymbol) isMatch = true;
                            } else if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
                                const refSymbol = reference.getSymbol();
                                const nameSymbol = expr.getNameNode().getSymbol();
                                if (refSymbol && nameSymbol && refSymbol === nameSymbol) isMatch = true;
                            }

                            if (isMatch) callSites.push(callExpression);
                        }


                        callSites.sort((a, b) => b.getStart() - a.getStart());

                        for (const callExpression of callSites) {
                            let stmtNode: import("ts-morph").Node | undefined = callExpression.getParent();
                            while (
                                stmtNode &&
                                stmtNode.getKind() !== SyntaxKind.ExpressionStatement &&
                                stmtNode.getKind() !== SyntaxKind.VariableStatement
                            ) {
                                stmtNode = stmtNode.getParent();
                            }
                            if (!stmtNode) continue;

                            const blockNode = stmtNode.getParent();
                            if (!blockNode || blockNode.getKind() !== SyntaxKind.Block) continue;

                            const block = blockNode.asKindOrThrow(SyntaxKind.Block);
                            const statements = block.getStatements();
                            const idx = statements.findIndex(s => s.getStart() === stmtNode!.getStart());
                            if (idx < 0) continue;

                            // Insert state.raise("<becomesRole>") immediately after the call statement
                            block.insertStatements(idx + 1, `state.raise("${becomesRole}");`);

                            console.log(
                                `[becomesRole/symex] Inserted state.raise("${becomesRole}") ` +
                                `after call at line ${callExpression.getStartLineNumber()} ` +
                                `in ${callExpression.getSourceFile().getBaseName()}`
                            );
                        }
                    }
                }
            }
        });
        const originalPath = sourceFile.getFilePath();
        sourceFile.saveSync();
        console.log(`Saved annotated file: ${originalPath}`);
    }


    let jsDocWithRaised = findJsDocWithRaised(project);
    for (const { node, roleName } of jsDocWithRaised) {
        const sf = node.getSourceFile();
        const line = node.getStartLineNumber();
        console.log(`${path.basename(sf.getFilePath())}:${line} ${node.getKindName()} @raised ${roleName}`);
    }


    const sortedRaised = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    for (const { node, roleName } of sortedRaised) {
        // Walk up to find the parent Block
        let blockNode = node.getParent();
        while (blockNode && blockNode.getKind() !== SyntaxKind.Block) {
            blockNode = blockNode.getParent();
        }
        if (!blockNode) continue;

        const block = blockNode.asKindOrThrow(SyntaxKind.Block);
        const statements = block.getStatements();

        // Find the `void 0;` placeholder that findJsDocWithRaised inserted
        const idx = statements.findIndex(s => s.getStart() === node.getStart());
        if (idx < 0) continue;

        // Replace placeholder with state.raise call — same mechanism as the main
        // flow's `const roleContextRaised_N` replacement, but using state.raise
        // since makeForSymex operates on the runtime state machine, not type vars.
        statements[idx].replaceWithText(`state.raise("${roleName}");`);

        console.log(`[raised/symex] Replaced void 0 with state.raise("${roleName}") at idx ${idx} in ${node.getSourceFile().getBaseName()}`);
    }

    project.saveSync();

    console.log("All TS files instrumented. Compiling to JS...");
    for (let i = 0; i < entryPoints.length; i++) {
        makeSymexDriver(project, entryPoints[i], path.join(targetDir, entryFiles[i]), path.join(targetDir, `driver_${i}.js`))
    }
    try {
        // Assumes a tsconfig.json exists in the targetDir
        execSync(`tsc --project ${targetDir}/tsconfig.json`, { stdio: "inherit" });
        console.log("Compilation finished. JS output generated.");
    } catch (err) {
        console.error("TypeScript compilation failed:", err);
    }


}

/**
 * Given a function/method node, collect all CallExpression nodes that invoke it,
 * including indirect calls through variable aliases like:
 *   const x = func;
 *   x();               // <-- this must be caught
 *   let y = x; y();   // <-- transitive aliases also caught
 */
function collectCallSitesForFn(
    fn: FunctionDeclaration | MethodDeclaration
): CallExpression[] {
    const callSites: CallExpression[] = [];
    const fnSymbol = fn.getSymbol();
    if (!fnSymbol) return callSites;

    // Track all symbols that are known aliases for this function.
    // Seed with the function's own symbol.
    const aliasedSymbols = new Set<import("ts-morph").Symbol>([fnSymbol]);

    // We iterate to a fixed point: as we discover new alias symbols we scan
    // all references again to find further aliases.
    let changed = true;
    while (changed) {
        changed = false;

        for (const sym of [...aliasedSymbols]) {
            // findReferencesAsNodes() only exists on specific narrowed node types,
            // not the base Node. Walk declarations and find one that supports it,
            // falling back to the name-node (Identifier) which always has it.
            const decls = sym.getDeclarations();
            if (!decls.length) continue;

            let refNodes: import("ts-morph").Node[] | undefined;
            for (const decl of decls) {
                const asAny = decl as any;
                if (typeof asAny.findReferencesAsNodes === "function") {
                    refNodes = asAny.findReferencesAsNodes() as import("ts-morph").Node[];
                    break;
                }
                // VariableDeclaration / BindingElement etc. expose the method on
                // their name node (an Identifier), which always has it.
                const nameNode = asAny.getNameNode?.();
                if (nameNode && typeof (nameNode as any).findReferencesAsNodes === "function") {
                    refNodes = (nameNode as any).findReferencesAsNodes() as import("ts-morph").Node[];
                    break;
                }
            }
            if (!refNodes) continue;

            for (const refNode of refNodes) {

                // ── Case 1: direct or method call  ───────────────────────────
                // e.g. func(...)  or  obj.func(...)
                const callExpr = refNode.getFirstAncestorByKind(SyntaxKind.CallExpression);
                if (callExpr) {
                    const expr = callExpr.getExpression();
                    let isDirectCallee = false;

                    if (expr.isKind(SyntaxKind.Identifier)) {
                        const exprSym = expr.getSymbol();
                        if (exprSym && aliasedSymbols.has(exprSym)) isDirectCallee = true;
                    } else if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
                        const nameSym = expr.getNameNode().getSymbol();
                        if (nameSym && aliasedSymbols.has(nameSym)) isDirectCallee = true;
                    }

                    if (isDirectCallee && !callSites.includes(callExpr)) {
                        callSites.push(callExpr);
                    }
                }

                // ── Case 2: alias assignment  ─────────────────────────────────
                // e.g.  const x = func;
                //        let x = func;
                //        var x = func;   (initializer, not a call)
                // The reference appears as the initializer of a VariableDeclaration.
                const varDecl = refNode.getParent();
                if (varDecl && varDecl.getKind() === SyntaxKind.VariableDeclaration) {
                    const vd = varDecl.asKindOrThrow(SyntaxKind.VariableDeclaration);
                    const initializer = vd.getInitializer();

                    // Make sure the reference IS the initializer (rhs), not the name (lhs)
                    if (initializer && initializer.getStart() === refNode.getStart()) {
                        const aliasSym = vd.getNameNode().getSymbol();
                        if (aliasSym && !aliasedSymbols.has(aliasSym)) {
                            aliasedSymbols.add(aliasSym);
                            changed = true; // trigger another pass to catch x() calls
                            console.log(
                                `[alias] '${vd.getName()}' is an alias for '${fn.getName?.() ?? "<anon>"}' ` +
                                `in ${vd.getSourceFile().getBaseName()}`
                            );
                        }
                    }
                }

                // ── Case 3: alias via assignment expression  ──────────────────
                // e.g.  x = func;   (already-declared variable re-assigned)
                const binaryExpr = refNode.getParent();
                if (
                    binaryExpr &&
                    binaryExpr.getKind() === SyntaxKind.BinaryExpression
                ) {
                    const bin = binaryExpr.asKindOrThrow(SyntaxKind.BinaryExpression);
                    const isAssign =
                        bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken;
                    const rhs = bin.getRight();

                    if (isAssign && rhs.getStart() === refNode.getStart()) {
                        const lhs = bin.getLeft();
                        if (lhs.isKind(SyntaxKind.Identifier)) {
                            const lhsSym = lhs.getSymbol();
                            if (lhsSym && !aliasedSymbols.has(lhsSym)) {
                                aliasedSymbols.add(lhsSym);
                                changed = true;
                                console.log(
                                    `[alias/assign] '${lhs.getText()}' assigned from '${fn.getName?.() ?? "<anon>"}' ` +
                                    `in ${bin.getSourceFile().getBaseName()}`
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    return callSites;
}

(async () => {
    const sourceDir = "examples/unsec";
    const targetDir = "examples/gen";
    const jsverSymdir = "examples/gen3"
    await cp(sourceDir, jsverSymdir, { recursive: true });
    console.log(`Copied ${sourceDir} to ${jsverSymdir}`);

    await cp(sourceDir, targetDir, { recursive: true });
    console.log(`Copied ${sourceDir} to ${targetDir}`);
    for (const dir of [targetDir, jsverSymdir]) { // this is stupid and dumb but needed
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".ts")) continue;

            anchorhack(`${dir}/${file}`);
        }
    }
    const project = new Project({
        compilerOptions: {
            target: ScriptTarget.ES2024
        },
    });

    project.addSourceFilesAtPaths(`${targetDir}/*.ts`);

    const sourceFile = project.addSourceFileAtPath(`${targetDir}/roles.ts`);
    const roleType = sourceFile.getFunction("roles");
    if (!roleType) throw new Error("Role type not found");

    // Parse JSDoc hierarchy
    const jsDoc = roleType.getJsDocs();
    if (!jsDoc) throw new Error("Role type has no JSDoc");

    const rolesTag = jsDoc[0].getTags().find(tag => tag.getTagName() === "roles");
    if (!rolesTag) throw new Error("@roles tag not found");

    const rolesLine = rolesTag.getCommentText(); // "0 < user < admin"

    const classNames = rolesLine!.split("<").map(s => s.trim());

    console.log(classNames);

    for (let i = 0; i < classNames.length; i++) {
        const clsName = classNames[i];
        const parentName = i > 0 ? classNames[i - 1] : undefined;

        const cls = sourceFile.addClass({
            name: clsName,
            isExported: true,
            extends: parentName,
        });

        cls.addMethod({
            name: `c${clsName}`,
            returnType: "void",
        });
    }
    console.log(project.getSourceFiles().map(p => p.getBaseName()))

    // Helper: find all JSDoc with @raised (any JSDocable node)


    for (const sourceFile of project.getSourceFiles()) {
        if (sourceFile.getBaseName() !== "roles.ts") {
            sourceFile.insertStatements(
                0,
                `import { ${classNames.join(", ")} } from "./roles";`
            );
        }
        // Find all function declarations
        sourceFile.forEachDescendant((node) => {
            // console.log("start")

            if (
                node.getKind() === SyntaxKind.FunctionDeclaration ||
                node.getKind() === SyntaxKind.MethodDeclaration
            ) {
                const fn = node.asKindOrThrow(
                    node.getKind() === SyntaxKind.FunctionDeclaration
                        ? SyntaxKind.FunctionDeclaration
                        : SyntaxKind.MethodDeclaration
                );


                // Skip if already has role argument
                if (fn.getParameters().some(p => p.getName() === "roleContext")) return;
                // console.log("test")
                // Check for @requiresRole annotation
                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "requiresRole");
                // console.log(jsDocs)
                if (!requiresRoleTag) {

                    fn.addParameter({
                        name: "roleContext",
                        type: classNames[0],
                        initializer: "new " + classNames[0]
                    });
                    return
                }



                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string" ? reqRaw.trim() : requiresRoleTag.getCommentText()?.trim()) ?? classNames[0];

                // ── Collect call sites (direct, method, AND aliased) ──────────
                const allCallSites = collectCallSitesForFn(fn);

                fn.addParameter({
                    name: "roleContext",
                    type: roleType,
                    hasQuestionToken: true,
                });
                const becomesTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "becomesRole")

                // Sort in reverse source order before mutating to keep positions stable
                allCallSites.sort((a, b) => b.getStart() - a.getStart());

                for (const callExpression of allCallSites) {
                    // ── Inject roleContext argument ───────────────────────────
                    // Determine which roleContext name is live at this call site by
                    // checking whether a becomesRole var has been inserted above.
                    // Walk up to the enclosing block and look for the most-recently-
                    // declared roleContextBecome_N / roleContextRaised_N above this call.
                    let activeRoleContextName = "roleContext";

                    let enclosingBlock: import("ts-morph").Node | undefined = callExpression.getParent();
                    while (enclosingBlock && enclosingBlock.getKind() !== SyntaxKind.Block) {
                        enclosingBlock = enclosingBlock.getParent();
                    }
                    if (enclosingBlock) {
                        const block = enclosingBlock.asKindOrThrow(SyntaxKind.Block);
                        const callStart = callExpression.getStart();
                        // Find the last roleContextBecome_N or roleContextRaised_N declared before this call
                        for (const stmt of block.getStatements()) {
                            if (stmt.getStart() >= callStart) break;
                            const text = stmt.getText().trim();
                            const m = text.match(/^const (roleContext(?:Become|Raised)_\d+)/);
                            if (m) activeRoleContextName = m[1];
                        }
                    }

                    // Only add argument if not already present
                    const alreadyInjected = callExpression.getArguments()
                        .some(a => /^roleContext/.test(a.getText()));
                    if (!alreadyInjected) {
                        callExpression.addArgument(activeRoleContextName);
                        console.log(
                            `[inject] Added '${activeRoleContextName}' to call at line ` +
                            `${callExpression.getStartLineNumber()} in ` +
                            `${callExpression.getSourceFile().getBaseName()}`
                        );
                    }

                    if (becomesTag && callExpression) {
                        const raw = becomesTag.getComment()
                        const becomesType = (typeof raw === "string" ? raw : becomesTag.getCommentText() ?? "").trim()

                        let stmtNode = callExpression.getParent()
                        while (stmtNode && stmtNode.getKind() !== SyntaxKind.ExpressionStatement && stmtNode.getKind() !== SyntaxKind.VariableStatement) {
                            stmtNode = stmtNode.getParent()
                        }
                        if (!stmtNode) continue

                        const blockNode = stmtNode.getParent()
                        if (!blockNode || blockNode.getKind() !== SyntaxKind.Block) continue

                        const block = blockNode.asKindOrThrow(SyntaxKind.Block)
                        const statements = block.getStatements()
                        const idx = statements.findIndex(s => s.getStart() === stmtNode!.getStart())
                        if (idx < 0) continue

                        const varName = `roleContextBecome_${idx}`
                        console.log(`[becomesRole] varName=${varName}`)

                        block.insertStatements(idx + 1, `const ${varName}: ${becomesType} = new ${becomesType}();`)

                        const affectedStatements = block.getStatements().slice(idx + 2)
                        for (const stmt of affectedStatements) {
                            stmt.forEachDescendant(desc => {
                                if (desc.getKind() !== SyntaxKind.CallExpression) return
                                const call = desc as CallExpression
                                const roleArgIdx = call.getArguments().findIndex(a => a.getText() === "roleContext")
                                if (roleArgIdx >= 0) call.getArguments()[roleArgIdx].replaceWithText(varName)
                            })
                        }
                    }
                }
            }
        });

        const originalPath = sourceFile.getFilePath();
        const newPath = originalPath.replace(/\.ts$/, ".annotated.ts");
        sourceFile.save();
        console.log(`Saved annotated file: ${newPath}`);
    }


    function getTargetStatement(node: import("ts-morph").Node) {
        if (node.getKind() === SyntaxKind.ExpressionStatement) {
            return node;
        }

        const parent = node.getParent();
        if (!parent || parent.getKind() !== SyntaxKind.Block) return undefined;

        const block = parent as import("ts-morph").Block;
        const statements = block.getStatements();

        // find first statement after comment/node
        const idx = statements.findIndex(s => s.getStart() >= node.getStart());
        if (idx >= 0) return statements[idx];

        return undefined;
    }
    // Apply @raised: find JSDoc with @raised (after tree has roleContext), insert variable and use it in the call
    const jsDocWithRaised = findJsDocWithRaised(project);
    console.log("\n--- JSDoc with @raised (ts-morph) ---");
    for (const { node, roleName } of jsDocWithRaised) {
        const sf = node.getSourceFile();
        const line = node.getStartLineNumber();
        console.log(`${path.basename(sf.getFilePath())}:${line} ${node.getKindName()} @raised ${roleName}`);
    }
    const sorted = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    for (const { node, roleName } of sorted) {
        // Find the parent block
        let blockNode = node.getParent();
        while (blockNode && blockNode.getKind() !== SyntaxKind.Block) {
            blockNode = blockNode.getParent();
        }
        if (!blockNode) continue;

        const block = blockNode.asKindOrThrow(SyntaxKind.Block);
        const statements = block.getStatements();

        // Find the index of the `@raised` placeholder statement
        const idx = statements.findIndex(s => s.getStart() === node.getStart());
        if (idx < 0) continue;

        const varName = `roleContextRaised_${idx}`;

        // Replace the placeholder with the variable declaration
        statements[idx].replaceWithText(`const ${varName}: ${roleName} = new ${roleName}();`);

        const affectedStatements = block.getStatements().slice(idx + 1)
        for (const stmt of affectedStatements) {
            stmt.forEachDescendant(desc => {
                if (desc.getKind() !== SyntaxKind.CallExpression) return
                const call = desc as CallExpression
                const roleArgIdx = call.getArguments().findIndex(a => a.getText() === "roleContext")
                if (roleArgIdx >= 0) call.getArguments()[roleArgIdx].replaceWithText(varName)
            })
        }
    }
    project.save();
    // const callIndex = buildCallIndex(project);

    const entryPoints: string[] = []
    const entryFiles: string[] = []
    for (const diag of project.getPreEmitDiagnostics()) {
        const sf = diag.getSourceFile()
        const start = diag.getStart()
        if (!sf || start === undefined) continue

        let node = sf.getDescendantAtPos(start)
        if (!node) continue

        let current = node.getParent()
        let fnName: string | undefined
        while (current) {
            const kind = current.getKind()
            if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration) {
                const fn = current as FunctionDeclaration | MethodDeclaration
                const name = fn.getName()
                if (name) fnName = name
                break
            }
            current = current.getParent()
        }
        if (!fnName) continue

        const msg = ts.flattenDiagnosticMessageText(diag.compilerObject.messageText, "\n")

        // Handle type mismatch errors
        const requiredTypeMatch = msg.match(/parameter of type '(\w+)'/)

        // Handle argument count mismatch errors
        const argCountMatch = msg.match(/Expected (\d+) arguments?, but got (\d+)/)

        if (!requiredTypeMatch && !argCountMatch) continue

        if (requiredTypeMatch) {
            const requiredType = requiredTypeMatch[1]
            console.log(`\nError in '${fnName}': needs '${requiredType}' (${msg.split("\n")[0]})`)
            const trace = reverseTraceUntilRole(project, fnName, requiredType)
            console.log(`Trace: [${trace.join(" -> ")}]`)
            if (trace[0]) {
                entryPoints.push(trace[0])
                entryFiles.push(path.basename(sf.getFilePath()))
                console.log(`[entry point] '${trace[0]}' in '${path.basename(sf.getFilePath())}'`)
            }
        } else if (argCountMatch) {
            const [, expected, got] = argCountMatch
            console.log(`\nError in '${fnName}': expected ${expected} args but got ${got} (${msg.split("\n")[0]})`)
            const trace = reverseTrace(project, fnName)
            console.log(`Trace: [${trace.join(" -> ")}]`)
            if (trace[0]) {
                entryPoints.push(trace[0])
                entryFiles.push(path.basename(sf.getFilePath()))
                console.log(`[entry point] '${trace[0]}' in '${path.basename(sf.getFilePath())}'`)
            }
        }
    }

    makeForSymex(jsverSymdir, classNames, entryPoints, entryFiles)
})();