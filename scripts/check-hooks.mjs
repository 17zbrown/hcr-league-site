#!/usr/bin/env node
/**
 * Rules of Hooks, enforced.
 *
 * WHY THIS EXISTS. The newsroom page crashed on open with a red error overlay
 * because useSearch() sat BELOW `if (isLoading) return <Skeleton/>`. On the first
 * render the guard fired and the hook never ran; on the second it did. React
 * counts hooks per render and throws outright when the count changes, so the page
 * was unopenable — not degraded, dead.
 *
 * `npm run lint` is `tsc`, and TypeScript cannot see this class of bug: the code
 * is perfectly well-typed. The usual answer is eslint-plugin-react-hooks, but this
 * repo has no ESLint at all, and adding one to catch a single rule is a lot of
 * dependency for the job. TypeScript is ALREADY a dependency and ships a real
 * parser, so this walks the actual AST instead of grepping — which matters,
 * because a regex version of this check produced two false positives on the first
 * run by pairing a `return` in one component with a hook in the next.
 *
 * WHAT IT FLAGS: a hook call that is reachable only after an early `return` in the
 * same function body. Hooks inside nested callbacks are ignored (they belong to
 * whatever function encloses them, which is usually not a component).
 *
 * Run: npm run check:hooks
 */
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const files = globSync('src/**/*.{ts,tsx}', { cwd: ROOT }).map((f) => path.join(ROOT, f))

const isHookName = (n) => /^use[A-Z]/.test(n)

/** The identifier being called, for `useX()` and `React.useX()` alike. */
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

/**
 * A function is a component/hook if its name starts uppercase (component) or
 * `use` (custom hook). Anything else — a helper, a map callback — is not subject
 * to the rules of hooks and is skipped.
 */
function functionIdentity(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
  return null
}

const problems = []

for (const file of files) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  /** Walk one function body, tracking whether an early return has been passed. */
  function checkBody(body, fnName) {
    if (!body || !ts.isBlock(body)) return
    let earlyReturnLine = null

    for (const stmt of body.statements) {
      // A `return` as the LAST statement is the normal exit, not an early return.
      const isLast = stmt === body.statements[body.statements.length - 1]

      if (earlyReturnLine !== null) {
        // Look for hook calls in this statement, but do not descend into nested
        // function bodies — those are their own scope.
        const findHooks = (node) => {
          if (
            ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
            ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
          ) return
          if (ts.isCallExpression(node)) {
            const name = calleeName(node.expression)
            if (name && isHookName(name)) {
              const { line } = src.getLineAndCharacterOfPosition(node.getStart(src))
              problems.push({
                file: path.relative(ROOT, file),
                line: line + 1,
                hook: name,
                fn: fnName,
                after: earlyReturnLine + 1,
              })
            }
          }
          ts.forEachChild(node, findHooks)
        }
        findHooks(stmt)
      }

      // Record the first early return we pass.
      if (earlyReturnLine === null && !isLast) {
        const returnsEarly =
          ts.isReturnStatement(stmt) ||
          (ts.isIfStatement(stmt) && !stmt.elseStatement && containsTopLevelReturn(stmt.thenStatement))
        if (returnsEarly) {
          const { line } = src.getLineAndCharacterOfPosition(stmt.getStart(src))
          earlyReturnLine = line
        }
      }
    }
  }

  function containsTopLevelReturn(stmt) {
    if (ts.isReturnStatement(stmt)) return true
    if (ts.isBlock(stmt)) return stmt.statements.some((s) => ts.isReturnStatement(s))
    return false
  }

  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    ) {
      const name = functionIdentity(node)
      if (name && (/^[A-Z]/.test(name) || isHookName(name))) checkBody(node.body, name)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
}

if (problems.length) {
  console.error('\n✗ Rules of Hooks violated — these pages will crash on render:\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`)
    console.error(`    ${p.hook}() runs only after the early return on line ${p.after}, inside <${p.fn}>.`)
    console.error(`    Move every hook ABOVE that return.\n`)
  }
  process.exit(1)
}

console.log(`✓ Rules of Hooks: no conditional hooks across ${files.length} files`)
