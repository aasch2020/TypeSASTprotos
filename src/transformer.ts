import { Project, ScriptTarget, SyntaxKind, FunctionDeclaration, MethodDeclaration, Node } from 'ts-morph';
import * as fs from 'fs/promises';
import * as path from 'path';
import MagicString from 'magic-string';

export async function transformProject(sourceDir: string, outDir: string): Promise<void> {
    const project = new Project({
        compilerOptions: { target: ScriptTarget.ES2024 },
    });
    project.addSourceFilesAtPaths(`${sourceDir}/**/*.ts`);

    for (const sourceFile of project.getSourceFiles()) {
        const originalPath = sourceFile.getFilePath();
        const relative = path.relative(sourceDir, originalPath);
        const outputPath = path.join(outDir, relative).replace(/\.ts$/, '.annotated.ts');
        const mapPath = outputPath + '.map';

        // Ensure output directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        const originalText = await fs.readFile(originalPath, 'utf8');
        const magicString = new MagicString(originalText);

        // --- 1. Add roleContext parameter to functions without it ---
        sourceFile.forEachDescendant((node) => {
            if (node.getKind() === SyntaxKind.FunctionDeclaration || node.getKind() === SyntaxKind.MethodDeclaration) {
                const fn = node as FunctionDeclaration | MethodDeclaration;
                if (fn.getParameters().some(p => p.getName() === 'roleContext')) return;

                const jsDocs = fn.getJsDocs();
                const requiresRoleTag = jsDocs.flatMap(d => d.getTags()).find(t => t.getTagName() === 'requiresRole');
                let roleType: string;
                if (requiresRoleTag) {
                    const raw = requiresRoleTag.getComment();
                    roleType = (typeof raw === 'string' ? raw : requiresRoleTag.getCommentText()?.trim()) || 'User';
                } else {
                    roleType = 'User'; // default lowest role
                }

                // Find insertion point: after last parameter or after '(' if none
                const params = fn.getParameters();
                let insertPos: number;
                if (params.length > 0) {
                    const lastParam = params[params.length - 1];
                    insertPos = lastParam.getEnd(); // after last parameter
                } else {
                    const fnText = fn.getText();
                    const parenIndex = fnText.indexOf('(');
                    insertPos = fn.getStart() + parenIndex + 1; // after '('
                }

                const paramText = params.length > 0 ? `, roleContext: ${roleType}` : `roleContext: ${roleType}`;
                magicString.appendRight(insertPos, paramText);
            }
        });

        // --- 2. Handle @raised annotations ---
        // Find all expression statements with @raised JSDoc
        const raisedNodes: { node: Node; roleName: string }[] = [];
        sourceFile.forEachDescendant((node) => {
            if (node.getKind() !== SyntaxKind.ExpressionStatement) return;
            const jsDocs = (node as any).getJsDocs?.();
            if (!jsDocs?.length) return;
            const raisedTag = jsDocs.flatMap((d: any) => d.getTags()).find((t: any) => t.getTagName() === 'raised');
            if (!raisedTag) return;
            const roleName = raisedTag.getCommentText()?.trim() || 'User';
            raisedNodes.push({ node, roleName });
        });

        // Process in reverse source order to keep positions valid (though magic‑string handles it, we still want determinism)
        raisedNodes.sort((a, b) => b.node.getStart() - a.node.getStart());
        for (const { node, roleName } of raisedNodes) {
            const block = node.getParent();
            if (!block || block.getKind() !== SyntaxKind.Block) continue;

            // Insert variable declaration right before the statement
            const statementStart = node.getStart();
            const varDecl = `const roleContextRaised: ${roleName} = new ${roleName}();\n`;
            magicString.appendRight(statementStart, varDecl);

            // Find the first call expression inside the statement and replace its first argument
            const call = node.getFirstDescendantByKind(SyntaxKind.CallExpression);
            if (call) {
                const args = call.getArguments();
                if (args.length > 0) {
                    const firstArg = args[0];
                    const argStart = firstArg.getStart();
                    const argEnd = firstArg.getEnd();
                    magicString.overwrite(argStart, argEnd, 'roleContextRaised');
                }
            }
        }

        // Generate final code and source map
        const finalCode = magicString.toString();
        const map = magicString.generateMap({
            source: relative,
            file: path.basename(outputPath),
            includeContent: true,
        });

        await fs.writeFile(outputPath, finalCode, 'utf8');
        await fs.writeFile(mapPath, JSON.stringify(map), 'utf8');
    }
}