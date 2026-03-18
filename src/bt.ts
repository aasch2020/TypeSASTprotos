import {
  Project,
  SyntaxKind,
  Node,
  CallExpression,
  Symbol as MorphSymbol
} from "ts-morph"

type Caller = {
  callerFunction: string
  file: string
}

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

export function reverseTrace(project: Project, callIndex: Map<MorphSymbol, Caller[]>, startName: string, depth = 5): string[] {

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
    if (visited.has(sym)) continue
    visited.add(sym)

    const callers = callIndex.get(sym) || []

    for (const c of callers) {

      console.log(
        `${" ".repeat(level * 2)}${c.callerFunction} -> ${sym.getName()} (${c.file})`
      )

      callerNames.push(c.callerFunction)

      const callerSym = findSymbolByName(project, c.callerFunction)

      if (callerSym) {
        queue.push({
          sym: callerSym,
          level: level + 1
        })
      }

    }

  }

  return callerNames
}
