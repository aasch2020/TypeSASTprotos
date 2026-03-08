import { Project, SyntaxKind } from "ts-morph";
import type { FunctionDeclaration, MethodDeclaration } from "ts-morph";
import type { RoleHierarchy } from "../types.ts";
import { getTagText } from "../utils.ts";

function getRequiredRole(fn: FunctionDeclaration | MethodDeclaration): string | undefined {
    const tag = fn
        .getJsDocs()
        .flatMap(doc => doc.getTags())
        .find(t => t.getTagName() === "requiresRole");

    if (!tag) return undefined;
    return getTagText(tag) || undefined;
}

export function injectRoleContextPass(project: Project, roles: RoleHierarchy): void {
    const lowestRole = roles[0];

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

            // Idempotency guard.
            if (fn.getParameters().some(p => p.getName() === "roleContext")) return;

            const requiredRole = getRequiredRole(fn);

            if (!requiredRole) {
                fn.addParameter({
                    name: "roleContext",
                    type: lowestRole,
                    initializer: `new ${lowestRole}`,
                });
                return;
            }

            // Propagate the caller's roleContext token to all known call sites
            // before adding the parameter so references resolve correctly.
            for (const ref of fn.findReferencesAsNodes()) {
                const call = ref.getFirstAncestorByKind(SyntaxKind.CallExpression);
                if (call) {
                    console.log(
                        `  injecting roleContext -> ${call.getSourceFile().getBaseName()}:${call.getStartLineNumber()} ${call.getFullText().trim()}`
                    );
                    call.addArgument("roleContext");
                }
            }

            fn.addParameter({ name: "roleContext", type: requiredRole });
        });
    }
}
