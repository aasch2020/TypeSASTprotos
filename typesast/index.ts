import { Project, ScriptTarget } from "ts-morph";
import { cp } from "fs/promises";

import { parseRoleHierarchy } from "./passes/parseRoles.ts";
import { emitRoleClasses } from "./passes/emitRoleClasses.ts";
import { injectRoleContextPass } from "./passes/injectRoleContext.ts";
import { applyRaisesToPass } from "./passes/applyRaisesTo.ts";

const SOURCE_DIR = "examples/unsec";
const TARGET_DIR = "examples/gen";

async function main(): Promise<void> {
    await cp(SOURCE_DIR, TARGET_DIR, { recursive: true });
    console.log(`Copied ${SOURCE_DIR} → ${TARGET_DIR}\n`);

    const project = new Project({
        compilerOptions: { target: ScriptTarget.ES2024 },
    });
    project.addSourceFilesAtPaths(`${TARGET_DIR}/*.ts`);

    const rolesFile = project.getSourceFileOrThrow("roles.ts");
    const roles = parseRoleHierarchy(rolesFile);
    console.log("Role hierarchy:", roles.join(" < "));

    emitRoleClasses(rolesFile, roles);
    console.log("Emitted role classes.\n");

    console.log("Injecting roleContext parameters...");
    injectRoleContextPass(project, roles);
    for (const sf of project.getSourceFiles()) {
        await sf.save();
    }

    console.log("Applying @raisesTo annotations...");
    applyRaisesToPass(project);

    await project.save();
    console.log("\nAll passes complete. Output written to", TARGET_DIR);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
