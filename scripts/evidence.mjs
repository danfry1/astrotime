/**
 * Collects a per-release evidence bundle: every verification claim the
 * project makes, with the machine-readable result behind it. Written to
 * evidence/evidence.json plus a human-readable summary, and attached to the
 * GitHub release so a reviewer can check the claims without running anything.
 *
 *   bun run build && node scripts/evidence.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { verificationInputHash } from './verification-inputs.mjs'

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const attempt = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const commit = run('git', ['rev-parse', 'HEAD'])
const trackedChanges = run('git', ['status', '--porcelain=v1', '--untracked-files=all'])
const worktreeClean = trackedChanges.length === 0

// Reproducible build: the packed tarball's integrity hash. npm <= 11 emits
// an array of packed entries; npm >= 12 emits an object keyed by package
// name. Accept both so a package-manager bump cannot silently break this.
const packOutput = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']))
const packed = Array.isArray(packOutput) ? packOutput : Object.values(packOutput)
const tarball = packed[0]
if (tarball?.shasum === undefined) {
  throw new Error(
    `Unrecognised 'npm pack --json' output shape: ${JSON.stringify(packOutput).slice(0, 200)}`,
  )
}

// Conformance digests (the same sweep under each available engine).
const conformance = {
  v8: attempt(() => run('node', ['scripts/conformance.mjs'])),
  jsc: attempt(() => run('bun', ['scripts/conformance.mjs'])),
}
conformance.identical = conformance.v8 !== null && conformance.v8 === conformance.jsc

// Mutation score, if a report is present.
const mutation = attempt(() => {
  const report = JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'))
  const provenance = JSON.parse(readFileSync('reports/mutation/provenance.json', 'utf8'))
  if (provenance.inputSha256 !== verificationInputHash()) {
    return {
      current: false,
      note: 'A mutation report exists, but its verification-input digest is stale.',
    }
  }
  let killed = 0
  let total = 0
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === 'Ignored') continue
      total += 1
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed += 1
    }
  }
  return {
    current: true,
    score: Number(((killed / total) * 100).toFixed(2)),
    killed,
    total,
    inputSha256: provenance.inputSha256,
    generatedAt: provenance.generatedAt,
    runtime: provenance.runtime,
  }
})

// Test and requirement counts.
const testCount = attempt(() => {
  const list = run('npx', ['vitest', 'list'])
  return list.split('\n').filter((line) => line.includes(' > ')).length
})
const requirements = readFileSync('REQUIREMENTS.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('| REQ-')).length

const evidence = {
  package: pkg.name,
  version: pkg.version,
  commit,
  commitSigned: attempt(() => run('git', ['log', '-1', '--format=%G?']) === 'G'),
  worktreeClean,
  artifact: {
    filename: tarball.filename,
    shasum: tarball.shasum,
    integrity: tarball.integrity,
    unpackedSize: tarball.unpackedSize,
    fileCount: tarball.entryCount,
    note: worktreeClean
      ? 'Rebuild from this commit and run `npm pack` to reproduce this shasum.'
      : 'Generated from a dirty worktree; this artifact cannot be attributed to or reproduced from the commit alone.',
  },
  dependencies: {
    runtime: Object.keys(pkg.dependencies ?? {}).length,
    note: 'A zero-runtime-dependency library; devDependencies are exact-pinned.',
  },
  verification: {
    tests: testCount,
    requirementsTraced: requirements,
    referenceImplementations: [
      'astropy 6.0.1 (ERFA/SOFA) golden + drift vectors',
      'NAIF CSPICE naif0012.tls ET and elapsed-TAI vectors',
      'astropy differential sweep workflow: UTC/TT/TDB/GPS/ordinal/JD, 100000 random instants',
    ],
    engines: conformance,
    mutation,
  },
  generatedFrom: 'scripts/evidence.mjs',
}

mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/evidence.json', `${JSON.stringify(evidence, null, 2)}\n`)

const summary = `# Evidence bundle — ${evidence.package} ${evidence.version}

Commit \`${evidence.commit}\`${evidence.commitSigned === true ? ' (signed)' : ''}; worktree **${evidence.worktreeClean ? 'clean' : 'DIRTY'}**

## Artifact

| | |
|---|---|
| File | \`${evidence.artifact.filename}\` |
| shasum | \`${evidence.artifact.shasum}\` |
| Integrity | \`${evidence.artifact.integrity}\` |
| Unpacked | ${evidence.artifact.unpackedSize} bytes in ${evidence.artifact.fileCount} files |
| Runtime dependencies | ${evidence.dependencies.runtime} |

${evidence.artifact.note} A package published by the release workflow additionally
carries an npm provenance attestation (verifiable with \`npm audit signatures\`).

## Verification

- **${evidence.verification.tests} tests**, ${evidence.verification.requirementsTraced} documented requirements traced to them (\`REQUIREMENTS.md\`, enforced in CI)
- Reference implementations:
${evidence.verification.referenceImplementations.map((r) => `  - ${r}`).join('\n')}
- Cross-engine determinism: ${conformance.identical === true ? 'identical digests' : 'DIVERGENT — investigate'}
  - V8: \`${conformance.v8 ?? 'n/a'}\`
  - JSC: \`${conformance.jsc ?? 'n/a'}\`
  - Hermes (React Native): checked separately by \`scripts/conformance-hermes.sh\` in the scheduled workflow; not executed by this generator
${mutation?.current === true ? `- Mutation score: **${mutation.score}%** (${mutation.killed}/${mutation.total} mutants killed; input \`${mutation.inputSha256}\`)` : mutation === null ? '- Mutation score: not included (no provenance-stamped report)' : `- Mutation score: **NOT INCLUDED** — ${mutation.note}`}

Generated by \`scripts/evidence.mjs\`.
`
writeFileSync('evidence/EVIDENCE.md', summary)
// eslint-disable-next-line no-console -- this script reports to the operator
console.log(summary)
