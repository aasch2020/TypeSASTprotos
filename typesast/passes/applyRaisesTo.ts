import { Project, SyntaxKind, Node } from "ts-morph";
import type { FunctionDeclaration, MethodDeclaration, Block } from "ts-morph";
import { getTagText } from "../utils.ts";

type RaisesToFn = {
    fn: FunctionDeclaration | MethodDeclaration;
    targetRole: string;
};

function collectRaisesToFunctions(project: Project): RaisesToFn[] {
    const results: RaisesToFn[] = [];

    for (const sf of project.getSourceFiles()) {
        sf.forEachDescendant((node) => {
            if (
                node.getKind() !== SyntaxKind.FunctionDeclaration &&
                node.getKind() !== SyntaxKind.MethodDeclaration
            ) return;

            const fn = node.asKindOrThrow(
                node.getKind() === SyntaxKind.FunctionDeclaration
                    ? SyntaxKind.FunctionDeclaration
                    : SyntaxKind.MethodDeclaration
            );

            const tag = fn
                .getJsDocs()
                .flatMap(doc => doc.getTags())
                .find(t => t.getTagName() === "raisesTo");

            if (!tag) return;

            const targetRole = getTagText(tag);
            if (targetRole) results.push({ fn, targetRole });
        });
    }

    return results;
}

/**
 * Walks up the AST from `node` to find the nearest ancestor that is a direct
 * child of a Block ("container statement" for this reference)
 */
function findContainerStatement(node: Node): { stmt: Node; block: Block } | undefined {
    let current: Node | undefined = node.getParent();
    while (current) {
        const parent = current.getParent();
        if (parent && parent.getKind() === SyntaxKind.Block) {
            return { stmt: current, block: parent as Block };
        }
        current = parent;
    }
    return undefined;
}

type PendingTransform = {
    block: Block;
    stmtStart: number;
    callStart: number;
    targetRole: string;
    isEmbedded: boolean;
};

export function applyRaisesToPass(project: Project): void {
    const fns = collectRaisesToFunctions(project);
    const pending: PendingTransform[] = [];

    for (const { fn, targetRole } of fns) {
        for (const ref of fn.findReferencesAsNodes()) {
            const container = findContainerStatement(ref);
            if (!container) continue;

            const { stmt, block } = container;

            const call = ref.getFirstAncestorByKind(SyntaxKind.CallExpression);
            if (!call) continue;

            pending.push({
                block,
                stmtStart: stmt.getStart(),
                callStart: call.getStart(),
                targetRole,
                isEmbedded: stmt.getKind() !== SyntaxKind.ExpressionStatement,
            });
        }
    }

    // Process later positions first so insertions don't shift earlier stored positions.
    pending.sort((a, b) => b.stmtStart - a.stmtStart);

    const varName = "roleContextRaised";
    const resultVar = "_raisedResult";

    for (const { block, stmtStart, callStart, targetRole, isEmbedded } of pending) {
        const statements = block.getStatements();
        const idx = statements.findIndex(s => s.getStart() === stmtStart);
        if (idx < 0) continue;

        const stmt = statements[idx];

        const call = stmt
            .getDescendantsOfKind(SyntaxKind.CallExpression)
            .find(c => c.getStart() === callStart);
        if (!call) continue;

        const roleContextArg = call.getArguments()
            .find(a => a.getText() === "roleContext");

        if (!isEmbedded) {
            // insert the elevated role var as a sibling before this statement,
            // then substitute it into the call in-place.
            block.insertStatements(idx, `const ${varName}: ${targetRole} = new ${targetRole}();`);
            roleContextArg?.replaceWithText(varName);
        } else {
            // capture the call text (with roleContext still in it), then:
            // first, replace the call expression in-place with a result variable.
            //  then, hoist the elevated role decl + the actual call before the
            //      container statement.
            const callText = call.getText();
            const hoistedCallText = roleContextArg
                ? callText.replace(/\broleContext\b/, varName)
                : callText;

            call.replaceWithText(resultVar);

            block.insertStatements(idx, [
                `const ${varName}: ${targetRole} = new ${targetRole}();`,
                `const ${resultVar} = ${hoistedCallText};`,
            ]);
        }
    }
}
