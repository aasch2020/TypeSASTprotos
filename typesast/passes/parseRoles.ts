import type { SourceFile } from "ts-morph";
import type { RoleHierarchy } from "../types.ts";

export function parseRoleHierarchy(rolesFile: SourceFile): RoleHierarchy {
    const rolesFn = rolesFile.getFunction("roles");
    if (!rolesFn) throw new Error("roles() sentinel function not found in roles.ts");

    const rolesTag = rolesFn
        .getJsDocs()
        .flatMap(doc => doc.getTags())
        .find(tag => tag.getTagName() === "roles");

    if (!rolesTag) throw new Error("@roles tag not found on roles()");

    const rolesLine = rolesTag.getCommentText();
    if (!rolesLine) throw new Error("@roles tag has no content");

    return rolesLine.split("<").map(s => s.trim());
}
