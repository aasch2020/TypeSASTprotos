import type { SourceFile } from "ts-morph";
import type { RoleHierarchy } from "../types.ts";

export function emitRoleClasses(rolesFile: SourceFile, roles: RoleHierarchy): void {
    for (let i = 0; i < roles.length; i++) {
        const name = roles[i];
        const parentName = i > 0 ? roles[i - 1] : undefined;

        const cls = rolesFile.addClass({ name, extends: parentName });
        cls.addMethod({ name: `c${name}`, returnType: "void" });
    }
}
