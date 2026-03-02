import { CallExpression, ConstructorDeclaration, FunctionDeclaration, MethodDeclaration, Project, ScriptTarget, SyntaxKind } from "ts-morph";
import * as fs from "fs";
import * as path from "path";


function copyDirectory(src: string, dest: string) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
const sourceDir = "unsec";
const targetDir = "gen";

copyDirectory(sourceDir, targetDir);
console.log(`Copied ${sourceDir} to ${targetDir}`);

const project = new Project({
    compilerOptions: {
        target: ScriptTarget.ES3
    },
});

project.addSourceFilesAtPaths("gen/*.ts");
const sourceFile = project.addSourceFileAtPath("gen/roles.ts");
const roleType = sourceFile.getFunction("roles");
if (!roleType) throw new Error("Role type not found");

// Parse JSDoc hierarchy
const jsDoc = roleType.getJsDocs();
if (!jsDoc) throw new Error("Role type has no JSDoc");

const rolesTag = jsDoc[0].getTags().find(tag => tag.getTagName() === "roles");
if (!rolesTag) throw new Error("@roles tag not found");

const rolesLine = rolesTag.getCommentText(); // "0 < user < admin"

const classNames = rolesLine!.split("<").map(s => s.trim());

// console.log(classNames);


for (let i = 0; i < classNames.length; i++) {
    const clsName = classNames[i];
    const parentName = i > 0 ? classNames[i - 1] : undefined;

    const cls = sourceFile.addClass({
        name: clsName,
        extends: parentName,
    });

    // Add methods for this class
    cls.addMethod({
        name: `c${clsName}`,
        returnType: "void"
    });
}

// Helper: find all JSDoc with @raised (any JSDocable node)
function findJsDocWithRaised(project: Project) {
    type RaisedEntry = { node: import("ts-morph").Node; roleName: string };
    const out: RaisedEntry[] = [];
    for (const sf of project.getSourceFiles()) {
        sf.forEachDescendant((node) => {
            const getJsDocs = (node as { getJsDocs?: () => { getTags: () => { getTagName: () => string; getComment: () => unknown; getCommentText: () => string } }[] }).getJsDocs;
            if (typeof getJsDocs !== "function") return;
            const docs = getJsDocs.call(node);
            if (!docs?.length) return;
            const raisedTag = docs.flatMap(d => d.getTags()).find(t => t.getTagName() === "raised");
            if (!raisedTag) return;
            const raw = raisedTag.getComment();
            const roleName = (typeof raw === "string" ? raw : raisedTag.getCommentText() ?? "").trim();
            if (roleName) out.push({ node, roleName });
        });
    }
    return out;
}

let authlist: (FunctionDeclaration | MethodDeclaration)[] = []
for (const sourceFile of project.getSourceFiles()) {

    // Find all function declarations
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
                // The reference will be the identifier node used in the call
                const callExpression = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);

                if (callExpression) {
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

// Apply @raised: find JSDoc with @raised (after tree has roleContext), insert variable and use it in the call
const jsDocWithRaised = findJsDocWithRaised(project);
console.log("\n--- JSDoc with @raised (ts-morph) ---");
for (const { node, roleName } of jsDocWithRaised) {
    const sf = node.getSourceFile();
    const line = node.getStartLineNumber();
    console.log(`${path.basename(sf.getFilePath())}:${line} ${node.getKindName()} @raised ${roleName}`);
}
// Process in reverse source order so insertions don't invalidate earlier nodes
const sorted = [...jsDocWithRaised].sort((a, b) => b.node.getStart() - a.node.getStart());
for (const { node, roleName } of sorted) {
    if (node.getKind() !== SyntaxKind.ExpressionStatement) continue;
    const parent = node.getParent();
    if (!parent || parent.getKind() !== SyntaxKind.Block) continue;
    const block = parent as import("ts-morph").Block;
    const statements = block.getStatements();
    const idx = statements.findIndex(s => s.getStart() === node.getStart());
    if (idx < 0) continue;
    const varName = "roleContextRaised";
    block.insertStatements(idx, `const ${varName}: ${roleName} = new ${roleName}();`);
    const call = node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
        const args = call.getArguments();
        if (args.length > 0) args[0].replaceWithText(varName);
    }
}
project.save();
console.log("\nDone (saved with @raised applied).");

