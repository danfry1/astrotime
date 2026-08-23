/**
 * Deterministic cyclomatic-complexity audit for production TypeScript.
 *
 * NASA NPR 7150.2D SWE-220 sets a maximum of 15 for identified
 * safety-critical software components. Astrotime applies that ceiling to all
 * production functions so adopters do not have to recover architectural
 * simplicity after classification.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const MAX_COMPLEXITY = 15

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() === true
      ? sourceFiles(path)
      : entry.name.endsWith('.ts') === true
        ? [path]
        : []
  })
}

/** @param {ts.FunctionLikeDeclaration} node @param {ts.SourceFile} source */
function displayName(node, source) {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text
  }
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return `<anonymous:${String(line + 1)}>`
}

/** @param {ts.FunctionLikeDeclaration} root */
function complexityOf(root) {
  let complexity = 1

  /** @param {ts.Node} node */
  function visit(node) {
    if (node !== root && ts.isFunctionLike(node)) return
    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCaseClause(node)
    ) {
      complexity += 1
    }
    ts.forEachChild(node, visit)
  }

  if (root.body !== undefined) visit(root.body)
  return complexity
}

const results = []
for (const file of sourceFiles('src')) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  /** @param {ts.Node} node */
  const inspect = (node) => {
    if (ts.isFunctionLike(node) && node.body !== undefined) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      results.push({
        file,
        line: line + 1,
        name: displayName(node, source),
        complexity: complexityOf(node),
      })
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
}

const violations = results.filter(({ complexity }) => complexity > MAX_COMPLEXITY)
const maximum = Math.max(...results.map(({ complexity }) => complexity))
if (process.argv.includes('--json') === true) {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      functions: results.length,
      maximum,
      limit: MAX_COMPLEXITY,
      violations,
    }),
  )
} else {
  for (const result of [...results].sort((a, b) => b.complexity - a.complexity)) {
    if (result.complexity < 10) break
    console.log(
      `${result.file}:${String(result.line)} ${result.name}: complexity ${String(result.complexity)}`,
    )
  }
}

if (violations.length > 0) {
  console.error(
    `Complexity check failed: ${String(violations.length)} production function(s) exceed ${String(MAX_COMPLEXITY)}`,
  )
  process.exit(1)
}
if (process.argv.includes('--json') === false) {
  console.log(
    `Complexity check passed: ${String(results.length)} production functions, maximum ${String(maximum)}/${String(MAX_COMPLEXITY)}`,
  )
}
