/**
 * Reverse call tracer: given a function name, prints every call site that invokes it,
 * then every call site that invokes those callers, and so on (BFS up the call graph).
 * Uses ts-morph to index all calls in the project and resolve symbols.
 */

import {
  Project,
  SyntaxKind,
  Node,
  CallExpression,
  Symbol as MorphSymbol
} from "ts-morph"

/** One call site: which function contains the call and in which file. */
type Caller = {
  callerFunction: string
  file: string
}

const project = new Project({
  tsConfigFilePath: "tsconfig.json"
})

/** Map from callee symbol to list of (caller name, file) for every call site. */
const callIndex = new Map<MorphSymbol, Caller[]>()

/** Returns the name of the function/method that contains the given node, or "top-level" / "anonymous". */
function getCallerFunction(node: Node): string {
  const fn = node.getFirstAncestor((a) =>
    Node.isFunctionDeclaration(a) ||
    Node.isMethodDeclaration(a) ||
    Node.isFunctionExpression(a) ||
    Node.isArrowFunction(a)
  )

  if (!fn) return "top-level"

  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getName() || "anonymous"
  }

  return "anonymous"
}

/** Returns the symbol of the function being called (f() or obj.method()). */
function resolveCallSymbol(call: CallExpression): MorphSymbol | undefined {

  const expr = call.getExpression()

  if (Node.isIdentifier(expr)) {
    return expr.getSymbol()
  }

  if (Node.isPropertyAccessExpression(expr)) {
    return expr.getNameNode().getSymbol()
  }

  return undefined
}

/**
 * Indexing: walk every source file's AST and record who calls what.
 * - For each node we only care about CallExpression (f() or obj.method()).
 * - sym = the symbol of the function being called (the callee).
 * - caller = the name of the function that contains this call, and its file.
 * After the loop, callIndex maps each callee symbol to the list of all (caller, file) pairs
 * that invoke it. reverseTrace uses this to go from a function to every place that calls it.
 */
console.log("Indexing call sites...")

for (const source of project.getSourceFiles()) {

  source.forEachDescendant((node) => {

    if (!Node.isCallExpression(node)) return

    const sym = resolveCallSymbol(node)
    if (!sym) return

    const caller: Caller = {
      callerFunction: getCallerFunction(node),
      file: source.getFilePath()
    }

    if (!callIndex.has(sym)) {
      callIndex.set(sym, [])
    }

    callIndex.get(sym)!.push(caller)

  })
}

console.log("Index built.")

/** Finds the ts-morph symbol for a function or method with the given name (first match in project). */
function findSymbolByName(name: string): MorphSymbol | undefined {

  for (const source of project.getSourceFiles()) {

    const funcs = source.getFunctions()
    for (const f of funcs) {
      if (f.getName() === name) {
        return f.getSymbol()
      }
    }

    const classes = source.getClasses()

    for (const c of classes) {
      for (const m of c.getMethods()) {
        if (m.getName() === name) {
          return m.getSymbol()
        }
      }
    }

  }

  return undefined
}

/** BFS from the function named startName: print each caller and recurse into callers up to depth. */
function reverseTrace(startName: string, depth = 5) {

  const startSym = findSymbolByName(startName)

  if (!startSym) {
    console.error("Function not found:", startName)
    return
  }

  const queue: { sym: MorphSymbol; level: number }[] = [
    { sym: startSym, level: 0 }
  ]

  const visited = new Set<MorphSymbol>()

  while (queue.length) {

    const { sym, level } = queue.shift()!
    if (visited.has(sym)) continue
    visited.add(sym)

    const callers = callIndex.get(sym) || []

    for (const c of callers) {

      console.log(
        `${" ".repeat(level * 2)}${c.callerFunction} -> ${sym.getName()} (${c.file})`
      )

      const callerSym = findSymbolByName(c.callerFunction)

      if (callerSym) {
        queue.push({
          sym: callerSym,
          level: level + 1
        })
      }

    }

  }

}

const target = process.argv[2]

if (!target) {
  console.error("Usage: ts-node reverse-call-trace.ts <function>")
  process.exit(1)
}

reverseTrace(target)