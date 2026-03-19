import { CallExpression, FunctionDeclaration, JSDoc, MethodDeclaration, ParameterDeclaration, Project, Scope, ScriptTarget, SyntaxKind, VariableDeclarationKind } from "ts-morph";
import { cp } from "fs/promises";
import * as path from "path";
import fs from "fs";
import { execSync } from "child_process";

export function makeSymexDriver(
    project: Project,
    funcName: string,
    tsFile: string,
    outFile: string
) {


    // Use the existing project to add the source file
    const sourceFile = project.addSourceFileAtPath(tsFile);

    // Find the exported function
    const func = sourceFile.getFunction(funcName);
    if (!func) throw new Error(`Function ${funcName} not found in ${tsFile}`);

    // Collect parameter names
    const params = func.getParameters().map((p: ParameterDeclaration) => p.getName());

    // Determine the JS file path (assume same name, .js)
    const jsModule = "./" + path.basename(tsFile, ".ts");

    // Generate driver code
    const lines: string[] = [];
    lines.push(`/* Generated symbolic driver for ${funcName} */`);
    lines.push(`var S$ = require("S$");`);
    lines.push(`var { state } = require("./state");`);
    lines.push(`var { ${funcName} } = require("${jsModule}");`);
    lines.push(`var out;`);

    // Create symbolic inputs
    params.forEach(p => {
        lines.push(`var ${p} = S$.symbol("${p}", "");`);
    });

    // Call the function
    lines.push(`out = ${funcName}(${params.join(", ")});`);
    lines.push(`console.log("Symbolic output:", out);`);

    // Wrap in a verify function
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

                // avoid duplicate insertion
                const alreadyHasMarker = stmts.some(s =>
                    s.getText().trim() === "void 0;"
                );

                if (!alreadyHasMarker) {
                    block.insertStatements(0, "void 0;");
                }
            }

            out.push({ node, roleName });
        });
    }

    return out;
}
function makeForSymex(targetDir: string, roles: string[]) {

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
            }
        });

        // Save each file individually (optional: can rename if you want)
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

    // Sort in reverse source order so insertions don't break earlier node positions
    // const sorted = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    // for (const { node, roleName } of sorted) {
    //     // Only insert inside a Block
    //     const parent = node.getParent();
    //     if (!parent || parent.getKind() !== SyntaxKind.Block) continue;

    //     const block = parent as import("ts-morph").Block;

    //     // Find the index of the original node
    //     const statements = block.getStatements();
    //     const idx = statements.findIndex(s => s.getStart() === node.getStart());
    //     if (idx < 0) continue;

    //     block.insertStatements(idx, `state.raise("${roleName}");`);
    // }

    project.saveSync();

    for (const sourceFile of project.getSourceFiles()) {
        insertStateRaiseSimple(sourceFile.getFilePath())
    }

    console.log("All TS files instrumented. Compiling to JS...");
    makeSymexDriver(project, "handleRequest", path.join(targetDir, "symextests.ts"), path.join(targetDir, "driver.js"))
    try {
        // Assumes a tsconfig.json exists in the targetDir
        execSync(`tsc --project ${targetDir}/tsconfig.json`, { stdio: "inherit" });
        console.log("Compilation finished. JS output generated.");
    } catch (err) {
        console.error("TypeScript compilation failed:", err);
    }


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
    makeForSymex(jsverSymdir, classNames)
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

                    return;
                } // nothing to add if no @requiresRole

                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string" ? reqRaw.trim() : requiresRoleTag.getCommentText()?.trim()) ?? classNames[0];
                const references = fn.findReferencesAsNodes();

                for (const reference of references) {
                    // The reference is a symbol usage node (Identifier, etc.)

                    const callExpression = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);
                    if (!callExpression) continue;

                    const expr = callExpression.getExpression();

                    // Case 1: direct call like foo(...)
                    if (expr.isKind(SyntaxKind.Identifier)) {
                        const refSymbol = reference.getSymbol();
                        const exprSymbol = expr.getSymbol();

                        if (!refSymbol || !exprSymbol) continue;

                        if (refSymbol !== exprSymbol) continue;

                        console.log(
                            `Found call in file: ${callExpression.getSourceFile().getFilePath()} ` +
                            `at line ${callExpression.getStartLineNumber()} ` +
                            `with full text ${callExpression.getFullText()}`
                        );

                        callExpression.addArgument("roleContext");
                    }
                }


                // Add parameter named roleContext with type equal to the requiresRole
                fn.addParameter({
                    name: "roleContext",
                    type: roleType,
                });
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
    project.saveSync()
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

        const block = blockNode as import("ts-morph").Block;
        const statements = block.getStatements();

        // Find the index of the `@raised` placeholder statement
        const idx = statements.findIndex(s => s.getStart() === node.getStart());
        if (idx < 0) continue;

        const varName = `roleContextRaised_${idx}`;

        // Replace the placeholder with the variable declaration
        statements[idx].replaceWithText(`const ${varName}: ${roleName} = new ${roleName}();`);

        // Replace calls in the same block **after the declaration**
        const affectedStatements = statements.slice(idx + 1);
        for (const stmt of affectedStatements) {
            stmt.forEachDescendant(desc => {
                if (desc.getKind() === SyntaxKind.CallExpression) {
                    const call = desc as CallExpression;
                    const args = call.getArguments();

                    if (args.length === 0) {
                        // If no args, just add the raised variable
                        call.addArgument(varName);
                    } else {
                        // Move the raised variable to **last argument**
                        const lastArg = args[args.length - 1];
                        lastArg.replaceWithText(varName);
                    }
                }
            });
        }
    }
    project.save();
    console.log("\nDone (saved with @raised applied).");
})();
