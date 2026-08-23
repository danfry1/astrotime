/**
 * Verifies the repository assurance chain:
 * - every requirement references live verification evidence;
 * - every requirement and hazard participates in TRACEABILITY.md;
 * - every implementation/evidence path in the traceability matrix exists.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const matrix = readFileSync('REQUIREMENTS.md', 'utf8')
const rows = matrix
  .split('\n')
  .filter((line) => line.startsWith('| REQ-'))
  .map((line) => {
    const cells = line.split('|').map((c) => c.trim())
    const fragments = [...(cells[3] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
    return { id: cells[1], fragments }
  })

const requirementIds = new Set(rows.map(({ id }) => id))

if (rows.length === 0) {
  console.error('No requirement rows found in REQUIREMENTS.md')
  process.exit(1)
}

const testList = execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list'], {
  encoding: 'utf8',
})
// Requirements may cite a job or step in any workflow, not just CI.
const workflows = readdirSync('.github/workflows')
  .map((file) => readFileSync(`.github/workflows/${file}`, 'utf8'))
  .join('\n')

let failures = 0
if (requirementIds.size !== rows.length) {
  console.error('REQUIREMENTS.md contains duplicate requirement IDs')
  failures += 1
}
for (const { id, fragments } of rows) {
  if (fragments.length === 0) {
    console.error(`${id}: no verifying tests referenced`)
    failures += 1
    continue
  }
  for (const fragment of fragments) {
    // A fragment may be a test title (vitest list) or a workflow job/step name.
    const found = testList.includes(fragment) === true || workflows.includes(fragment) === true
    if (!found) {
      console.error(`${id}: referenced test/job not found: "${fragment}"`)
      failures += 1
    }
  }
}

const hazardRows = readFileSync('HAZARD-LOG.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('| HAZ-'))
const hazardIds = new Set(hazardRows.map((line) => line.split('|')[1]?.trim()))
if (hazardRows.length === 0) {
  console.error('No hazard rows found in HAZARD-LOG.md')
  failures += 1
}
if (hazardIds.size !== hazardRows.length) {
  console.error('HAZARD-LOG.md contains duplicate hazard IDs')
  failures += 1
}

const traceRows = readFileSync('TRACEABILITY.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('| HAZ-'))
const tracedHazards = new Set()
const tracedRequirements = new Set()
for (const line of traceRows) {
  const cells = line.split('|').map((cell) => cell.trim())
  const hazard = cells[1]
  if (hazard !== undefined) tracedHazards.add(hazard)

  for (const id of line.match(/REQ-[A-Z]+-\d{3}/g) ?? []) {
    if (!requirementIds.has(id)) {
      console.error(`TRACEABILITY.md references unknown requirement ${id}`)
      failures += 1
    }
    tracedRequirements.add(id)
  }

  // Only the design/implementation and verification columns are paths.
  for (const cell of [cells[3] ?? '', cells[4] ?? '']) {
    for (const match of cell.matchAll(/`([^`]+)`/g)) {
      const path = match[1]
      if (path !== undefined && existsSync(path) === false) {
        console.error(`TRACEABILITY.md references missing path ${path}`)
        failures += 1
      }
    }
  }
}

for (const id of requirementIds) {
  if (!tracedRequirements.has(id)) {
    console.error(`${id}: no hazard/implementation mapping in TRACEABILITY.md`)
    failures += 1
  }
}
for (const id of hazardIds) {
  if (id !== undefined && !tracedHazards.has(id)) {
    console.error(`${id}: no requirements/evidence mapping in TRACEABILITY.md`)
    failures += 1
  }
}
for (const id of tracedHazards) {
  if (!hazardIds.has(id)) {
    console.error(`TRACEABILITY.md references unknown hazard ${id}`)
    failures += 1
  }
}

if (failures > 0) {
  console.error(
    `Traceability check failed: ${String(failures)} broken reference(s) across ${String(rows.length)} requirements and ${String(hazardIds.size)} hazards`,
  )
  process.exit(1)
}
console.log(
  `Traceability check passed: ${String(rows.length)} requirements and ${String(hazardIds.size)} hazards map to live implementation and verification evidence`,
)
