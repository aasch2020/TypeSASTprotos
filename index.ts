import { CallExpression, FunctionDeclaration, MethodDeclaration, Project, ScriptTarget, SyntaxKind } from "ts-morph";
import { cp } from "fs/promises";

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
            extends: parentName,
        });
    
        // Add methods for this class
        cls.addMethod({
            name: `c${clsName}`,
            returnType: "void"
        });
    }
    console.log(project.getSourceFiles().map(p => p.getBaseName()))
    // 2. Get all descendant call expressions
    
    
    // for (const sourceFile of project.getSourceFiles()) {
    //  sourceFile.forEachDescendant((node) => {
    //         // console.log("start")
    
    //         if (
    //             node.getKind() === SyntaxKind.FunctionDeclaration ||
    //             node.getKind() === SyntaxKind.MethodDeclaration
    //         ) {
    //             const fn = node.asKindOrThrow(
    //             node.getKind() === SyntaxKind.FunctionDeclaration
    //                 ? SyntaxKind.FunctionDeclaration
    //                 : SyntaxKind.MethodDeclaration
    //         );
    
    //         // 4. Find all references (call sites)
    //         const refs = fn.findReferences();
    //         console.log("refs" + fn.findReferences().length)
    //         for (const ref of refs) {
    //         for (const refEntry of ref.getReferences()) {
    //             const refd = refEntry.getNode();
    //             console.log(refd.getType().getText(), refd.getFullText(), "\n", refd)
    //             // Check if this is a call expression
    //             const callExpr = node.getParentIfKind(SyntaxKind.CallExpression);
    //             if (callExpr) {
    //             console.log("Call site found at:", callExpr.getSourceFile().getFilePath(), "line:", callExpr.getStartLineNumber());
    //             console.log("Call code:", callExpr.getText());
    //             }
    //         }
    //         }
    //     }
    
    //     });
    
    
    
    // }
    
    let authlist: (FunctionDeclaration | MethodDeclaration)[] = []
    for (const sourceFile of project.getSourceFiles()) {
    
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
    
                const roleType = (requiresRoleTag.getComment() as string).trim() ?? classNames[0];
                const references = fn.findReferencesAsNodes();
                for (const reference of references) {
                    // The reference will be the identifier node used in the call
                    const callExpression = reference.getFirstAncestorByKind(SyntaxKind.CallExpression);
    
                    if (callExpression) {
                        console.log(`Found call in file: ${callExpression.getSourceFile().getFilePath()} at line ${callExpression.getStartLineNumber()} with full text ${callExpression.getFullText()}`);
                        // You can then perform operations on the callExpression node
                        callExpression.addArgument("roleContext")
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
})();
