# TypeSAST

Prototype **type-based static analysis** for **access control** in TypeScript. Annotations live in **JSDoc** at function and block scope; a **ts-morph** pipeline rewrites sources so role requirements are expressed as **types**, and the ordinary TypeScript checker reports mismatches as type errors. A secondary path instruments code for **symbolic execution** (e.g. [ExpoSE](https://github.com/ExpoSEJS/ExpoSE)) on selected targets derived from diagnostics and call-site backtracking.

Research context: *Type-Based Static Analysis for Access Control in TypeScript* (Alex Asch, Eric Huang, Nick Petrone, UC San Diego).



## JSDoc language (static pass)

| Tag | Role |
|-----|------|
| `@roles r0 < r1 < … < rN` | Declares a **linear** role hierarchy (encoded as classes extending the previous role). |
| `@requiresRole R` | Caller must supply a `roleContext` typed as `R` (or compatible). |
| `@becomesRole R` | Function elevates the effective role for its scope (propagated at transformed callsites). |
| `@raised R` | Block-level elevation; subsequent calls in the block use the raised context. |

**Caveats:** First-class functions limit completeness (aliases across blocks, callbacks through `any`-typed receivers, etc.). The paper discusses these cases and the “high–low–high” control-flow pattern. Also: `any` typed parameters cannot be checked

## Single hierarchy V1

The entire working V1 driver exists under `v1driver.ts` it expects one target directory, and will create two copies, one for type based analysis, and one for the copied verion for symbolic driver generation.

**ExpoSE integration** to run with ExpoSE, run ExpoSE at the numbered generated driver files. NOTE: this is experimental, and may not be performant or stable.

## Despot configuration (v2)

Optional **Despot** DSL (Chevrotain) describes roles and DAG-style relationships in `.ds` files, for example:

```text
@role admin
@role user
@default unauth
@hierarchy user < admin
```

Parsed config can drive the v2 transform pipeline (`src/common/config.ts`). The CLI path below primarily uses the JSDoc `@roles` line in `roles.ts`.

## Repository layout

| Path | Purpose |
|------|---------|
| `src/cli.ts` | CLI: copy → transform → diagnostics → symex instrumentation copy |
| `src/common/transform.ts` | VS Code / extension-oriented transform + source-map hooks |
| `src/common/config.ts` | Despot lexer/parser |
| `src/bt.ts` | Call indexing and backtracking for symex targets |
| `src/extension.ts` | VS Code commands: run transform + map diagnostics to original sources |
| `examples/unsec`, `examples/sec`, `examples/gen3` | Sample inputs and generated-style outputs |
| `eval/unsec` | Evaluation tree (includes `roles.ds` for Despot experiments) |

## Prerequisites

- Node.js (see `package.json` / your environment)
- TypeScript (`typescript` is a dev dependency; `tsc` is invoked on symex output directories)

For symbolic execution, install and run **ExpoSE** separately; generated drivers `require("S$")` and `./state` as in `src/cli.ts`.

## Build

```bash
npm install
npm run dev
```

This runs `esbuild` and emits `dist/` (including `dist/cli.cjs` and the extension bundle).

## CLI usage

The CLI expects **three directories**: a clean **source** tree, a **transform target** (copy + annotated TypeScript), and a **third copy** for JS/symex instrumentation.

```bash
node dist/cli.cjs <sourceDir> <targetDir> <jsverSymdir>
```

Example (after `npm run dev`):

```bash
node dist/cli.cjs examples/unsec .typesast-build/ts .typesast-build/symex
```

Create the parent directory for the output folders first if needed (for example `New-Item -ItemType Directory -Force .typesast-build` in PowerShell).

The pipeline expects `roles.ts` with a `roles()` function whose JSDoc contains `@roles …`. Point the second and third arguments at empty or disposable directories so you do not overwrite tracked examples.

## VS Code extension

The package declares commands **Run typechecking** (`typesast.check`) and **Run SymEx and Annotate code** (`typesast.symex`). The extension applies `transform()` and maps diagnostics back using source maps. It is a work in progress

To hack on it: open the repo in VS Code, build with `npm run dev`, then launch the extension host from **Run and Debug** (see `.vscode/launch.json`).

