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
export function buildCallIndex(project: Project): Map<MorphSymbol, Caller[]> {
  const callIndex = new Map<MorphSymbol, Caller[]>()

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
  return callIndex
}

/** Finds the ts-morph symbol for a function or method with the given name (first match in project). */
export function findSymbolByName(project: Project, name: string): MorphSymbol | undefined {

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
function findCallSites(sym: MorphSymbol): Caller[] {
  const decl = sym.getDeclarations()[0]
  if (!decl) return []

  const refs = decl.asKind(SyntaxKind.FunctionDeclaration)?.findReferencesAsNodes()
    ?? decl.asKind(SyntaxKind.MethodDeclaration)?.findReferencesAsNodes()
    ?? []

  return refs
    .filter((ref) => {
      const parent = ref.getParent()
      return parent !== undefined && Node.isCallExpression(parent)
    })
    .map((ref) => ({
      callerFunction: getCallerFunction(ref),
      file: ref.getSourceFile().getFilePath()
    }))
}

export function reverseTrace(project: Project, startName: string, depth = 5): string[] {
  const startSym = findSymbolByName(project, startName)

  if (!startSym) {
    console.error("Function not found:", startName)
    return []
  }

  const queue: { sym: MorphSymbol; level: number }[] = [
    { sym: startSym, level: 0 }
  ]

  const visited = new Set<MorphSymbol>()
  const callerNames: string[] = []

  while (queue.length) {
    const { sym, level } = queue.shift()!
    if (visited.has(sym) || level >= depth) continue
    visited.add(sym)

    for (const c of findCallSites(sym)) {
      console.log(`${" ".repeat(level * 2)}${c.callerFunction} -> ${sym.getName()} (${c.file})`)
      callerNames.push(c.callerFunction)

      const callerSym = findSymbolByName(project, c.callerFunction)
      if (callerSym) queue.push({ sym: callerSym, level: level + 1 })
    }
  }

  return callerNames
}
export function reverseTraceUntilRole(
  project: Project,
  startName: string,
  requiredType: string,
  depth = 10
): string[] {
  const startSym = findSymbolByName(project, startName)
  if (!startSym) return []
  const queue: { sym: MorphSymbol; level: number }[] = [{ sym: startSym, level: 0 }]
  const visited = new Set<MorphSymbol>()
  const results: string[] = []
  while (queue.length) {
    const { sym, level } = queue.shift()!
    if (visited.has(sym) || level >= depth) continue
    visited.add(sym)
    for (const c of findCallSites(sym)) {
      const callerSym = findSymbolByName(project, c.callerFunction)
      if (!callerSym) continue
      const decl = callerSym.getDeclarations()[0]
      const fn = decl?.asKind(SyntaxKind.FunctionDeclaration)
        ?? decl?.asKind(SyntaxKind.MethodDeclaration)
      if (!fn) continue
      const roleParam = fn.getParameters().find(p => p.getName() === "roleContext")
      const roleParamType = roleParam?.getType().getText()
      const shortType = roleParamType?.split(".").pop() ?? roleParamType
      console.log(`${"  ".repeat(level)}${c.callerFunction} -> ${sym.getName()} (roleContext: ${shortType})`)
      if (shortType === requiredType) {
        console.log(`${"  ".repeat(level + 1)}^ found: '${c.callerFunction}' has required role '${requiredType}'`)
        results.push(c.callerFunction)
        continue
      }
      queue.push({ sym: callerSym, level: level + 1 })
    }
  }
  return results
}