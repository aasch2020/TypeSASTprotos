import { CallExpression, FunctionDeclaration, MethodDeclaration, Project, Scope, ScriptTarget, SyntaxKind, ts, VariableDeclarationKind } from "ts-morph";
import { cp } from "fs/promises";
import * as path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { reverseTrace, reverseTraceUnprotected } from "./src/bt"

export function makeSymexDriver(
    project: Project,
    funcName: string,
    tsFile: string,
    outFile: string,
    initialRole?: string
) {
    const sourceFile = project.addSourceFileAtPath(tsFile);

    const func = sourceFile.getFunction(funcName);
    if (!func) throw new Error(`Function ${funcName} not found in ${tsFile}`);

    const jsModule = "./" + path.basename(tsFile, ".ts");

    const lines: string[] = [];
    lines.push(`/* Generated symbolic driver for ${funcName} */`);
    lines.push(`var S$ = require("S$");`);
    lines.push(`var { state } = require("./state");`);
    lines.push(`var { ${funcName} } = require("${jsModule}");`);
    lines.push(`var out;`);

    if (initialRole) {
        lines.push(`state.currentRole = "${initialRole}";`);
    }

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
}

function anchorhack(filePath: string) {
    let code = fs.readFileSync(filePath, "utf-8");
    const regex = /\/\*\*\s*@raised\s+([a-zA-Z0-9_-]+)\s*\*\//g;
    code = code.replace(regex, (x, _role) => `${x} \n void 0;`);
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
            const roleName = (typeof raw === "string" ? raw : raisedTag.getCommentText() ?? "").trim();

            if (!roleName) return;

            out.push({ node, roleName });
        });
    }

    return out;
}

function makeForSymex(targetDir: string, roles: string[], entryPoints: string[], entryFiles: string[], entryRoles: string[]) {
    console.log("[symex] Building state machine...");
    const project = new Project({
        compilerOptions: {
            target: ScriptTarget.ES2024,
            module: 1,
        },
    });

    const allFiles = project.addSourceFilesAtPaths(path.join(targetDir, "*.ts"));

    const stateFile = project.createSourceFile(
        path.join(targetDir, "state.ts"),
        "",
        { overwrite: true }
    );

    const roleUnion = roles.map(r => `"${r}"`).join(" | ");

    const cls = stateFile.addClass({
        name: "AnalysisState",
        properties: [
            {
                name: "currentRole",
                type: roleUnion,
                scope: Scope.Public,
            },
            {
                name: "raisedRole",
                type: roleUnion + " | null",
                scope: Scope.Public,
            }
        ],
        ctors: [
            {
                statements: [
                    `this.currentRole = "${roles[0]}";`,
                    `this.raisedRole = null;`,
                ]
            }
        ],
        methods: [
            {
                name: "raise",
                parameters: [{ name: "role", type: roleUnion }],
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
        if (file.getBaseName() === "state.ts") continue;
        const hasImport = file.getImportDeclarations().some(id => id.getModuleSpecifierValue() === "./state");
        if (!hasImport) {
            file.insertStatements(0, `import { state } from "./state";`);
        }
        file.saveSync();
    }

    console.log("[symex] Instrumenting files...");
    for (const sourceFile of project.getSourceFiles()) {
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

                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "requiresRole");

                if (!requiresRoleTag) return;

                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string"
                    ? reqRaw.trim()
                    : requiresRoleTag.getCommentText()?.trim()) ?? "unauth";

                fn.insertStatements(0, `state.require${roleType[0].toUpperCase() + roleType.slice(1)}();`);

                const becomesTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "becomesRole");

                if (becomesTag) {
                    const raw = becomesTag.getComment();
                    const becomesRole = (typeof raw === "string" ? raw.trim() : becomesTag.getCommentText()?.trim()) ?? "";

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

                            block.insertStatements(idx + 1, `state.raise("${becomesRole}");`);
                        }
                    }
                }
            }
        });
        sourceFile.saveSync();
    }

    console.log("[symex] Processing @raised tags...");
    const jsDocWithRaised = findJsDocWithRaised(project);
    const sortedRaised = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    for (const { node, roleName } of sortedRaised) {
        let blockNode = node.getParent();
        while (blockNode && blockNode.getKind() !== SyntaxKind.Block) {
            blockNode = blockNode.getParent();
        }
        if (!blockNode) continue;

        const block = blockNode.asKindOrThrow(SyntaxKind.Block);
        const statements = block.getStatements();
        const idx = statements.findIndex(s => s.getStart() === node.getStart());
        if (idx < 0) continue;

        statements[idx].replaceWithText(`state.raise("${roleName}");`);
    }

    project.saveSync();

    console.log("[symex] Generating drivers and compiling...");
    for (let i = 0; i < entryPoints.length; i++) {
        makeSymexDriver(project, entryPoints[i], path.join(targetDir, entryFiles[i]), path.join(targetDir, `driver_${i}.js`), entryRoles[i]);
    }
    try {
        execSync(`tsc --project ${targetDir}/tsconfig.json`, { stdio: "inherit" });
        console.log("[symex] Compilation finished.");
    } catch (err) {
        console.error("[symex] TypeScript compilation failed:", err);
    }
}

function collectCallSitesForFn(
    fn: FunctionDeclaration | MethodDeclaration
): CallExpression[] {
    const callSites: CallExpression[] = [];
    const fnSymbol = fn.getSymbol();
    if (!fnSymbol) return callSites;

    const aliasedSymbols = new Set<import("ts-morph").Symbol>([fnSymbol]);

    let changed = true;
    while (changed) {
        changed = false;

        for (const sym of [...aliasedSymbols]) {
            const decls = sym.getDeclarations();
            if (!decls.length) continue;

            let refNodes: import("ts-morph").Node[] | undefined;
            for (const decl of decls) {
                const asAny = decl as any;
                if (typeof asAny.findReferencesAsNodes === "function") {
                    refNodes = asAny.findReferencesAsNodes() as import("ts-morph").Node[];
                    break;
                }
                const nameNode = asAny.getNameNode?.();
                if (nameNode && typeof (nameNode as any).findReferencesAsNodes === "function") {
                    refNodes = (nameNode as any).findReferencesAsNodes() as import("ts-morph").Node[];
                    break;
                }
            }
            if (!refNodes) continue;

            for (const refNode of refNodes) {
                // ── Case 1: direct or method call ────────────────────────────
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

                // ── Case 2: alias assignment ──────────────────────────────────
                const varDecl = refNode.getParent();
                if (varDecl && varDecl.getKind() === SyntaxKind.VariableDeclaration) {
                    const vd = varDecl.asKindOrThrow(SyntaxKind.VariableDeclaration);
                    const initializer = vd.getInitializer();

                    if (initializer && initializer.getStart() === refNode.getStart()) {
                        const aliasSym = vd.getNameNode().getSymbol();
                        if (aliasSym && !aliasedSymbols.has(aliasSym)) {
                            aliasedSymbols.add(aliasSym);
                            changed = true;
                        }
                    }
                }

                // ── Case 3: alias via assignment expression ───────────────────
                const binaryExpr = refNode.getParent();
                if (binaryExpr && binaryExpr.getKind() === SyntaxKind.BinaryExpression) {
                    const bin = binaryExpr.asKindOrThrow(SyntaxKind.BinaryExpression);
                    const isAssign = bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken;
                    const rhs = bin.getRight();

                    if (isAssign && rhs.getStart() === refNode.getStart()) {
                        const lhs = bin.getLeft();
                        if (lhs.isKind(SyntaxKind.Identifier)) {
                            const lhsSym = lhs.getSymbol();
                            if (lhsSym && !aliasedSymbols.has(lhsSym)) {
                                aliasedSymbols.add(lhsSym);
                                changed = true;
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
    const sourceDir = process.argv[2];
    if (!sourceDir) throw new Error("Usage: ts-node index.ts <source-dir>");

    const baseName = path.basename(sourceDir.replace(/\/+$/, ""));
    const parentDir = path.dirname(sourceDir.replace(/\/+$/, ""));
    const targetDir = path.join(parentDir, baseName + "_secgen");
    const jsverSymdir = path.join(parentDir, baseName + "_symex");

    console.log("[setup] Copying source directories...");
    await cp(sourceDir, jsverSymdir, { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });

    console.log("[setup] Running anchor hack...");
    for (const dir of [targetDir, jsverSymdir]) {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith(".ts")) continue;
            anchorhack(`${dir}/${file}`);
        }
    }

    const project = new Project({
        compilerOptions: { target: ScriptTarget.ES2024 },
    });

    project.addSourceFilesAtPaths(`${targetDir}/*.ts`);

    const sourceFile = project.addSourceFileAtPath(`${targetDir}/roles.ts`);
    const roleType = sourceFile.getFunction("roles");
    if (!roleType) throw new Error("Role type not found");

    const jsDoc = roleType.getJsDocs();
    if (!jsDoc) throw new Error("Role type has no JSDoc");

    const rolesTag = jsDoc[0].getTags().find(tag => tag.getTagName() === "roles");
    if (!rolesTag) throw new Error("@roles tag not found");

    const rolesLine = rolesTag.getCommentText();
    const classNames = rolesLine!.split("<").map(s => s.trim());
    console.log("[setup] Roles:", classNames);

    for (let i = 0; i < classNames.length; i++) {
        const clsName = classNames[i];
        const parentName = i > 0 ? classNames[i - 1] : undefined;
        const cls = sourceFile.addClass({ name: clsName, isExported: true, extends: parentName });
        cls.addMethod({ name: `c${clsName}`, returnType: "void" });
    }

    console.log("[static] Injecting role parameters and call sites...");
    for (const sourceFile of project.getSourceFiles()) {
        if (sourceFile.getBaseName() !== "roles.ts") {
            sourceFile.insertStatements(0, `import { ${classNames.join(", ")} } from "./roles";`);
        }

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

                if (fn.getParameters().some(p => p.getName() === "roleContext")) return;

                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "requiresRole");

                if (!requiresRoleTag) {
                    fn.addParameter({ name: "roleContext", type: classNames[0], initializer: "new " + classNames[0] });
                    return;
                }

                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string" ? reqRaw.trim() : requiresRoleTag.getCommentText()?.trim()) ?? classNames[0];

                const allCallSites = collectCallSitesForFn(fn);
                const callbackWraps: { parentCall: CallExpression; argIdx: number; wrapper: string; }[] = [];

                fn.addParameter({ name: "roleContext", type: roleType, hasQuestionToken: false });

                const becomesTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "becomesRole");

                const fnSymbol = fn.getSymbol();
                if (fnSymbol) {
                    const decls = fnSymbol.getDeclarations();
                    for (const decl of decls) {
                        const asAny = decl as any;
                        let refNodes: import("ts-morph").Node[] | undefined;

                        if (typeof asAny.findReferencesAsNodes === "function") {
                            refNodes = asAny.findReferencesAsNodes() as import("ts-morph").Node[];
                        } else {
                            const nameNode = asAny.getNameNode?.();
                            if (nameNode && typeof (nameNode as any).findReferencesAsNodes === "function") {
                                refNodes = (nameNode as any).findReferencesAsNodes() as import("ts-morph").Node[];
                            }
                        }
                        if (!refNodes) continue;

                        for (const refNode of refNodes) {
                            const parentNode = refNode.getParent();
                            if (parentNode && parentNode.getKind() === SyntaxKind.CallExpression) {
                                const parentCall = parentNode.asKindOrThrow(SyntaxKind.CallExpression);
                                const args = parentCall.getArguments();
                                const argIdx = args.findIndex(a => a.getStart() === refNode.getStart());

                                if (argIdx >= 0) {
                                    let activeRoleContextName = "roleContext";

                                    let enclosingBlock: import("ts-morph").Node | undefined = parentCall.getParent();
                                    while (enclosingBlock && enclosingBlock.getKind() !== SyntaxKind.Block) {
                                        enclosingBlock = enclosingBlock.getParent();
                                    }
                                    if (enclosingBlock) {
                                        const block = enclosingBlock.asKindOrThrow(SyntaxKind.Block);
                                        const callStart = parentCall.getStart();
                                        for (const stmt of block.getStatements()) {
                                            if (stmt.getStart() >= callStart) break;
                                            const m = stmt.getText().trim().match(/^const (roleContext(?:Become|Raised)_\d+)/);
                                            if (m) activeRoleContextName = m[1];
                                        }
                                    }

                                    const fnName = refNode.getText();
                                    const fnParams = fn.getParameters().filter(p => p.getName() !== "roleContext");
                                    const paramList = fnParams.map(p => `${p.getName()}: ${p.getType().getText()}`).join(", ");
                                    const argList = fnParams.map(p => p.getName()).join(", ");
                                    const wrapper = argList.length > 0
                                        ? `(${paramList}) => ${fnName}(${argList}, ${activeRoleContextName})`
                                        : `() => ${fnName}(${activeRoleContextName})`;

                                    callbackWraps.push({ parentCall, argIdx, wrapper });
                                }
                            }
                        }
                    }
                }

                allCallSites.sort((a, b) => b.getStart() - a.getStart());

                for (const callExpression of allCallSites) {
                    let activeRoleContextName = "roleContext";

                    let enclosingBlock: import("ts-morph").Node | undefined = callExpression.getParent();
                    while (enclosingBlock && enclosingBlock.getKind() !== SyntaxKind.Block) {
                        enclosingBlock = enclosingBlock.getParent();
                    }
                    if (enclosingBlock) {
                        const block = enclosingBlock.asKindOrThrow(SyntaxKind.Block);
                        const callStart = callExpression.getStart();
                        for (const stmt of block.getStatements()) {
                            if (stmt.getStart() >= callStart) break;
                            const m = stmt.getText().trim().match(/^const (roleContext(?:Become|Raised)_\d+)/);
                            if (m) activeRoleContextName = m[1];
                        }
                    }

                    const alreadyInjected = callExpression.getArguments().some(a => /^roleContext/.test(a.getText()));
                    if (!alreadyInjected) {
                        callExpression.addArgument(activeRoleContextName);
                    }

                    if (becomesTag && callExpression) {
                        const raw = becomesTag.getComment();
                        const becomesType = (typeof raw === "string" ? raw : becomesTag.getCommentText() ?? "").trim();

                        let stmtNode = callExpression.getParent();
                        while (stmtNode && stmtNode.getKind() !== SyntaxKind.ExpressionStatement && stmtNode.getKind() !== SyntaxKind.VariableStatement) {
                            stmtNode = stmtNode.getParent();
                        }
                        if (!stmtNode) continue;

                        const blockNode = stmtNode.getParent();
                        if (!blockNode || blockNode.getKind() !== SyntaxKind.Block) continue;

                        const block = blockNode.asKindOrThrow(SyntaxKind.Block);
                        const statements = block.getStatements();
                        const idx = statements.findIndex(s => s.getStart() === stmtNode!.getStart());
                        if (idx < 0) continue;

                        const varName = `roleContextBecome_${idx}`;
                        block.insertStatements(idx + 1, `const ${varName}: ${becomesType} = new ${becomesType}();`);

                        const affectedStatements = block.getStatements().slice(idx + 2);
                        for (const stmt of affectedStatements) {
                            stmt.forEachDescendant(desc => {
                                if (desc.getKind() !== SyntaxKind.CallExpression) return;
                                const call = desc as CallExpression;
                                const roleArgIdx = call.getArguments().findIndex(a => a.getText() === "roleContext");
                                if (roleArgIdx >= 0) call.getArguments()[roleArgIdx].replaceWithText(varName);
                            });
                        }
                    }
                }

                callbackWraps.sort((a, b) => b.parentCall.getStart() - a.parentCall.getStart());
                for (const { parentCall, argIdx, wrapper } of callbackWraps) {
                    parentCall.getArguments()[argIdx].replaceWithText(wrapper);
                }
            }
        });

        sourceFile.save();
    }

    console.log("[static] Processing @raised tags...");
    const jsDocWithRaised = findJsDocWithRaised(project);
    const sorted = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    for (const { node, roleName } of sorted) {
        let blockNode = node.getParent();
        while (blockNode && blockNode.getKind() !== SyntaxKind.Block) {
            blockNode = blockNode.getParent();
        }
        if (!blockNode) continue;

        const block = blockNode.asKindOrThrow(SyntaxKind.Block);
        const statements = block.getStatements();
        const idx = statements.findIndex(s => s.getStart() === node.getStart());
        if (idx < 0) continue;

        const varName = `roleContextRaised_${idx}`;
        statements[idx].replaceWithText(`const ${varName}: ${roleName} = new ${roleName}();`);

        const affectedStatements = block.getStatements().slice(idx + 1);
        for (const stmt of affectedStatements) {
            stmt.forEachDescendant(desc => {
                if (desc.getKind() !== SyntaxKind.CallExpression) return;
                const call = desc as CallExpression;
                const roleArgIdx = call.getArguments().findIndex(a => a.getText() === "roleContext");
                if (roleArgIdx >= 0) call.getArguments()[roleArgIdx].replaceWithText(varName);
            });
        }
    }

    project.save();

    console.log("[static] Collecting diagnostics...");
    const entryPoints: string[] = [];
    const entryFiles: string[] = [];
    const entryRoles: string[] = [];
    const hardFails: { fnName: string; msg: string; file: string }[] = [];
    const diagLines: string[] = [];

    const log = (line: string) => { console.log(line); diagLines.push(line); };
    const err = (line: string) => { console.error(line); diagLines.push(line); };

    function getRoleForFn(name: string): string {
        for (const sf of project.getSourceFiles()) {
            for (const fn of sf.getFunctions()) {
                if (fn.getName() === name) {
                    const rp = fn.getParameters().find(p => p.getName() === "roleContext");
                    const t = rp?.getType().getText().split(".").pop();
                    if (t) return t.charAt(0).toLowerCase() + t.slice(1);
                }
            }
        }
        return classNames[0];
    }

    for (const diag of project.getPreEmitDiagnostics()) {
        const sf = diag.getSourceFile();
        const start = diag.getStart();
        if (!sf || start === undefined) continue;

        let node = sf.getDescendantAtPos(start);
        if (!node) continue;

        let current = node.getParent();
        let fnName: string | undefined;
        while (current) {
            const kind = current.getKind();
            if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration) {
                const fn = current as FunctionDeclaration | MethodDeclaration;
                const name = fn.getName();
                if (name) fnName = name;
                break;
            }
            current = current.getParent();
        }
        if (!fnName) continue;

        const msg = ts.flattenDiagnosticMessageText(diag.compilerObject.messageText, "\n");
        const file = path.basename(sf.getFilePath());

        const requiredTypeMatch = msg.match(/parameter of type '(\w+)'/);
        const argCountMatch = msg.match(/Expected (\d+) arguments?, but got (\d+)/);
        const callbackMismatchMatch = msg.match(/Argument of type '.*' is not assignable to parameter of type '.*=> /);

        if (!requiredTypeMatch && !argCountMatch && !callbackMismatchMatch) continue;

        if (requiredTypeMatch) {
            const requiredType = requiredTypeMatch[1];
            const { roots, discarded } = reverseTraceUnprotected(project, fnName, requiredType);
            if (roots.length > 0) {
                for (const entry of roots) {
                    log(`[symex] '${fnName}' needs '${requiredType}' - unprotected root: '${entry}' in '${file}'`);
                    entryPoints.push(entry);
                    entryFiles.push(file);
                    entryRoles.push(getRoleForFn(entry));
                }
            } else if (discarded > 0) {
                log(`[false positive] '${fnName}' needs '${requiredType}' but all ${discarded} path(s) are protected - '${file}'`);
            } else {
                err(`[hard fail] '${fnName}' needs '${requiredType}' but no entry point found - '${file}': ${msg.split("\n")[0]}`);
                hardFails.push({ fnName, msg: msg.split("\n")[0], file });
            }
        } else if (argCountMatch) {
            const [, expected, got] = argCountMatch;
            const trace = reverseTrace(project, fnName);
            if (trace[0]) {
                log(`[symex] '${fnName}' expected ${expected} args got ${got} - trace: [${trace.join(" -> ")}] in '${file}'`);
                entryPoints.push(trace[0]);
                entryFiles.push(file);
                entryRoles.push(getRoleForFn(trace[0]));
            } else {
                err(`[hard fail] '${fnName}' expected ${expected} args got ${got} but no entry point found - '${file}': ${msg.split("\n")[0]}`);
                hardFails.push({ fnName, msg: msg.split("\n")[0], file });
            }
        } else if (callbackMismatchMatch) {
            const innerRoleMatch = msg.match(/Type '(\w+)' is not assignable to type '(\w+)'/);
            const requiredType = innerRoleMatch ? innerRoleMatch[2] : undefined;

            if (requiredType) {
                const { roots, discarded } = reverseTraceUnprotected(project, fnName, requiredType);
                if (roots.length > 0) {
                    for (const entry of roots) {
                        log(`[symex] '${fnName}' callback mismatch (needs '${requiredType}') - unprotected root: '${entry}' in '${file}'`);
                        entryPoints.push(entry);
                        entryFiles.push(file);
                        entryRoles.push(getRoleForFn(entry));
                    }
                } else if (discarded > 0) {
                    log(`[false positive] '${fnName}' callback mismatch but all ${discarded} path(s) are protected - '${file}'`);
                } else {
                    log(`[symex] '${fnName}' callback mismatch, no unprotected root found - using '${fnName}' as entry in '${file}'`);
                    entryPoints.push(fnName);
                    entryFiles.push(file);
                    entryRoles.push(getRoleForFn(fnName));
                }
            } else {
                const trace = reverseTrace(project, fnName);
                if (trace.length > 0) {
                    for (const entry of trace) {
                        log(`[symex] '${fnName}' callback mismatch - unprotected root: '${entry}' in '${file}'`);
                        entryPoints.push(entry);
                        entryFiles.push(file);
                        entryRoles.push(getRoleForFn(entry));
                    }
                } else {
                    log(`[symex] '${fnName}' callback mismatch, no trace found - using '${fnName}' as entry in '${file}'`);
                    entryPoints.push(fnName);
                    entryFiles.push(file);
                    entryRoles.push(getRoleForFn(fnName));
                }
            }
        }
    }

    if (hardFails.length > 0) {
        err(`\n[hard fail summary] ${hardFails.length} violation(s) with no reachable entry point:`);
        for (const { fnName, msg, file } of hardFails) {
            err(`  • ${file} :: ${fnName} - ${msg}`);
        }
    }

    const seen = new Set<string>();
    const dedupedPoints: string[] = [];
    const dedupedFiles: string[] = [];
    const dedupedRoles: string[] = [];
    for (let i = 0; i < entryPoints.length; i++) {
        const key = `${entryFiles[i]}::${entryPoints[i]}`;
        if (!seen.has(key)) {
            seen.add(key);
            dedupedPoints.push(entryPoints[i]);
            dedupedFiles.push(entryFiles[i]);
            dedupedRoles.push(entryRoles[i]);
        }
    }

    log(`\n[done] ${dedupedPoints.length} entry point(s) queued for symex (${entryPoints.length - dedupedPoints.length} duplicate(s) dropped), ${hardFails.length} hard fail(s):`);
    for (let i = 0; i < dedupedPoints.length; i++) {
        log(`  • [symex] ${dedupedFiles[i]} :: ${dedupedPoints[i]}`);
    }
    for (const { fnName, file } of hardFails) {
        log(`  • [hard fail] ${file} :: ${fnName}`);
    }

    const outFile = path.join(targetDir, "diagnostics.log");
    fs.writeFileSync(outFile, diagLines.join("\n") + "\n", "utf-8");
    console.log(`[done] Diagnostics written to ${outFile}`);

    makeForSymex(jsverSymdir, classNames, dedupedPoints, dedupedFiles, dedupedRoles);
})();