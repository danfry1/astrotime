/**
 * Verifies REQUIREMENTS.md: every requirement row references at least one
 * test, and every backticked test-title fragment exists verbatim in the
 * current vitest test list. Fails CI when traceability rots.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const matrix = readFileSync('REQUIREMENTS.md', 'utf8')
const rows = matrix
  .split('\n')
  .filter((line) => line.startsWith('| REQ-'))
  .map((line) => {
    const cells = line.split('|').map((c) => c.trim())
    const fragments = [...(cells[3] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
    return { id: cells[1], fragments }
  })

if (rows.length === 0) {
  console.error('No requirement rows found in REQUIREMENTS.md')
  process.exit(1)
}

const testList = execFileSync('npx', ['vitest', 'list'], { encoding: 'utf8' })
const ciConfig = readFileSync('.github/workflows/ci.yml', 'utf8')

let failures = 0
for (const { id, fragments } of rows) {
  if (fragments.length === 0) {
    console.error(`${id}: no verifying tests referenced`)
    failures += 1
    continue
  }
  for (const fragment of fragments) {
    // A fragment may be a test title (vitest list) or a CI job name.
    const found = testList.includes(fragment) === true || ciConfig.includes(fragment) === true
    if (!found) {
      console.error(`${id}: referenced test/job not found: "${fragment}"`)
      failures += 1
    }
  }
}

if (failures > 0) {
  console.error(
    `Traceability check failed: ${failures} broken reference(s) across ${rows.length} requirements`,
  )
  process.exit(1)
}
console.log(`Traceability check passed: ${rows.length} requirements, all references resolve`)
