import { CallExpression, FunctionDeclaration, MethodDeclaration, Project, ScriptTarget, SyntaxKind } from "ts-morph";
import { cp } from "fs/promises";
import * as path from "path";

(async ()=>{
    const sourceDir = "unsec";
    const targetDir = "gen";
    
    await cp(sourceDir, targetDir, {recursive: true});
    console.log(`Copied ${sourceDir} to ${targetDir}`);
    
    const project = new Project({
        compilerOptions: {
            target: ScriptTarget.ES2024
        },
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
    
    console.log(classNames);
    
    for (let i = 0; i < classNames.length; i++) {
        const clsName = classNames[i];
        const parentName = i > 0 ? classNames[i - 1] : undefined;
    
        const cls = sourceFile.addClass({
            name: clsName,
            extends: parentName,
        });
    
        cls.addMethod({
            name: `c${clsName}`,
            returnType: "void"
        });
    }

function findJsDocWithRaised(project: Project) {
    type RaisedEntry = { node: import("ts-morph").Node; roleName: string };
    const out: RaisedEntry[] = [];

    for (const sf of project.getSourceFiles()) {
        sf.forEachDescendant((node) => {
            let roleName: string | undefined;

            // normal JSDoc
            if ("getJsDocs" in node && typeof node.getJsDocs === "function") {
                const docs = node.getJsDocs();
                const raisedTag = docs
                    .flatMap(d => d.getTags())
                    .find(t => t.getTagName() === "raised");

                if (raisedTag) {
                    const raw = raisedTag.getComment();
                    roleName = (typeof raw === "string"
                        ? raw
                        : raisedTag.getCommentText() ?? "").trim();
                }
            }

            // fallback
            if (!roleName) {
                const ranges = node.getLeadingCommentRanges();
                for (const r of ranges) {
                    const text = r.getText();
                    if (text.startsWith("/**") && text.includes("@raised")) {
                        const match = text.match(/@raised\s+([^\s*]+)/);
                        if (match) {
                            roleName = match[1].trim();
                            break;
                        }
                    }
                }
            }

            if (roleName) {
                out.push({ node, roleName });
            }
        });
    }

    return out;
}

// 🔥 NEW: resolve correct statement target
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

    let authlist: (FunctionDeclaration | MethodDeclaration)[] = []
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
    
                if (fn.getParameters().some(p => p.getName() === "roleContext")) return;
    
                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs
                    .flatMap(doc => doc.getTags())
                    .find(tag => tag.getTagName() === "requiresRole");
    
                if (!requiresRoleTag) {
                    fn.addParameter({
                        name: "roleContext",
                        type: classNames[0],
                        initializer: "new " + classNames[0]
                    });
                    return;
                }
    
                const reqRaw = requiresRoleTag.getComment();
                const roleType = (typeof reqRaw === "string" ? reqRaw.trim() : requiresRoleTag.getCommentText()?.trim()) ?? classNames[0];
    
                const references = fn.findReferencesAsNodes();
                for (const reference of references) {
                    const callExpression = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);
                    if (callExpression) {
                        callExpression.addArgument("roleContext");
                    }
                }
    
                fn.addParameter({
                    name: "roleContext",
                    type: roleType,
                });
            }
        });
    
        sourceFile.save();
    }

    const jsDocWithRaised = findJsDocWithRaised(project);

    const sorted = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());

    for (const { node, roleName } of sorted) {
        const stmt = getTargetStatement(node);
        if (!stmt || stmt.getKind() !== SyntaxKind.ExpressionStatement) continue;

        const parent = stmt.getParent();
        if (!parent || parent.getKind() !== SyntaxKind.Block) continue;

        const block = parent as import("ts-morph").Block;
        const statements = block.getStatements();

        const idx = statements.findIndex(s => s.getStart() === stmt.getStart());
        if (idx < 0) continue;

        const varName = `roleContextRaised_${idx}`;
        block.insertStatements(idx, `const ${varName}: ${roleName} = new ${roleName}();`);

        const call = stmt.getFirstDescendantByKind(SyntaxKind.CallExpression);
        if (call) {
            const args = call.getArguments();
            if (args.length > 0) args[0].replaceWithText(varName);
        }
    }

    await project.save();
    console.log("\nDone (saved with @raised applied).");
})();