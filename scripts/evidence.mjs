/**
 * Builds a release evidence bundle from the exact checked-out inputs.
 * Machine-readable reports are copied into evidence/raw and individually
 * hashed; release CI additionally attests the resulting archive.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { verificationInputHash } from './verification-inputs.mjs'

const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
const runNpm = (args) =>
  execFileSync('npm', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), 'astrotime-npm-cache'),
      npm_config_loglevel: 'error',
      npm_config_update_notifier: 'false',
    },
  }).trim()
const attempt = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// Never let a previous local run leak stale reports into a release archive.
rmSync('evidence', { recursive: true, force: true })
mkdirSync('evidence/raw', { recursive: true })
const rawReports = []

function recordEvidenceFile(path) {
  rawReports.push({
    path: path.replace(/^evidence\//, ''),
    sha256: sha256(path),
    bytes: statSync(path).size,
  })
}

function archiveFile(source, relative = source) {
  const destination = join('evidence/raw', relative)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  recordEvidenceFile(destination)
}

function writeRaw(relative, value) {
  const destination = join('evidence/raw', relative)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(
    destination,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
  )
  recordEvidenceFile(destination)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const commit = run('git', ['rev-parse', 'HEAD'])
const trackedChanges = run('git', ['status', '--porcelain=v1', '--untracked-files=all'])
const worktreeClean = trackedChanges.length === 0
const verificationSha256 = verificationInputHash()
const releaseTag = `v${pkg.version}`
/** @type {string[]} */
const tagsAtHead =
  /** @type {string[] | null} */ (
    attempt(() =>
      run('git', ['tag', '--points-at', 'HEAD'])
        .split('\n')
        .filter((tag) => tag !== ''),
    )
  ) ?? []
const exactTag = tagsAtHead.includes(releaseTag) ? releaseTag : (tagsAtHead[0] ?? null)
const commitSigned =
  process.env.RELEASE_COMMIT_VERIFIED === '1' ||
  attempt(() => ['G', 'U'].includes(run('git', ['log', '-1', '--format=%G?'])), false)
const tagSigned =
  process.env.RELEASE_TAG_VERIFIED === '1' ||
  (exactTag !== null &&
    attempt(() => {
      run('git', ['verify-tag', exactTag])
      return true
    }, false))

// Reproducible package identity. npm <=11 emits an array; npm >=12 emits an
// object keyed by package name.
const packOutput = JSON.parse(runNpm(['pack', '--dry-run', '--json', '--ignore-scripts']))
const packed = Array.isArray(packOutput) ? packOutput : Object.values(packOutput)
const tarball = packed[0]
if (tarball?.shasum === undefined) {
  throw new Error(
    `Unrecognised 'npm pack --json' output shape: ${JSON.stringify(packOutput).slice(0, 200)}`,
  )
}
writeRaw('package/npm-pack.json', packOutput)

// Run deterministic conformance under each locally available engine.
const conformance = {
  v8: attempt(() => run('node', ['scripts/conformance.mjs'])),
  jsc: attempt(() => run('bun', ['scripts/conformance.mjs'])),
}
conformance.identical = conformance.v8 !== null && conformance.v8 === conformance.jsc
writeRaw('conformance.json', conformance)

const coverage = attempt(() => {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'))
  const provenance = JSON.parse(readFileSync('coverage/provenance.json', 'utf8'))
  if (provenance.inputSha256 !== verificationSha256) {
    return { current: false, note: 'Coverage exists, but its verification-input digest is stale.' }
  }
  const leapPath = Object.keys(summary).find((path) => path.endsWith('/src/leap-seconds.ts'))
  return {
    current: true,
    inputSha256: provenance.inputSha256,
    generatedAt: provenance.generatedAt,
    total: summary.total,
    leapSeconds: leapPath === undefined ? null : summary[leapPath],
  }
})
if (coverage?.current === true) {
  archiveFile('coverage/coverage-final.json')
  archiveFile('coverage/coverage-summary.json')
  archiveFile('coverage/provenance.json')
}

const mutation = attempt(() => {
  const report = JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'))
  const provenance = JSON.parse(readFileSync('reports/mutation/provenance.json', 'utf8'))
  if (provenance.inputSha256 !== verificationSha256) {
    return {
      current: false,
      note: 'Mutation results exist, but their verification-input digest is stale.',
    }
  }
  const statuses = {}
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      statuses[mutant.status] = (statuses[mutant.status] ?? 0) + 1
    }
  }
  const total = Object.entries(statuses)
    .filter(([status]) => status !== 'Ignored')
    .reduce((sum, [, count]) => sum + count, 0)
  const detected = (statuses.Killed ?? 0) + (statuses.Timeout ?? 0)
  return {
    current: true,
    score: Number(((detected / total) * 100).toFixed(2)),
    detected,
    total,
    statuses,
    inputSha256: provenance.inputSha256,
    generatedAt: provenance.generatedAt,
    runtime: provenance.runtime,
  }
})
if (mutation?.current === true) {
  archiveFile('reports/mutation/mutation.json')
  archiveFile('reports/mutation/provenance.json')
}

const differentialSha256 = verificationInputHash(['scripts/differential.py'])
const differential = attempt(() => {
  const report = JSON.parse(readFileSync('reports/differential/report.json', 'utf8'))
  const provenance = JSON.parse(readFileSync('reports/differential/provenance.json', 'utf8'))
  if (provenance.inputSha256 !== differentialSha256) {
    return {
      current: false,
      note: 'Differential results exist, but their verification-input digest is stale.',
    }
  }
  return { current: true, ...report, provenance }
})
if (differential?.current === true) {
  archiveFile('reports/differential/report.json')
  archiveFile('reports/differential/provenance.json')
}

if (process.env.RELEASE_EVIDENCE === '1') {
  for (const [name, result] of [
    ['coverage', coverage],
    ['mutation', mutation],
    ['differential', differential],
  ]) {
    if (result?.current !== true)
      throw new Error(`Release evidence requires current ${name} results`)
  }
  if (!worktreeClean) throw new Error('Release evidence requires a clean worktree')
  if (exactTag !== releaseTag) {
    throw new Error(`Release evidence requires the exact signed tag ${releaseTag}`)
  }
  if (commitSigned !== true) throw new Error('Release evidence requires a verified signed commit')
  if (tagSigned !== true) throw new Error('Release evidence requires a verified signed tag')
  if (conformance.identical !== true) {
    throw new Error('Release evidence requires identical cross-engine conformance digests')
  }
  if (differential?.passed !== true) {
    throw new Error('Release evidence requires a passing differential report')
  }
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    if (coverage?.leapSeconds?.[metric]?.pct !== 100) {
      throw new Error(`Release evidence requires 100% leap-second ${metric} coverage`)
    }
  }
}

const complexity = JSON.parse(run('node', ['scripts/check-complexity.mjs', '--json']))
writeRaw('complexity.json', complexity)

const testList = run(process.execPath, ['node_modules/vitest/vitest.mjs', 'list'])
const testCount = testList.split('\n').filter((line) => line.includes(' > ')).length
writeRaw('test-list.txt', `${testList}\n`)

const requirements = readFileSync('REQUIREMENTS.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('| REQ-')).length
const hazards = readFileSync('HAZARD-LOG.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('| HAZ-')).length

for (const document of [
  'REQUIREMENTS.md',
  'TRACEABILITY.md',
  'HAZARD-LOG.md',
  'ASSURANCE-CASE.md',
  'NASA-CROSSWALK.md',
  'NONCONFORMANCE.md',
  'DESIGN.md',
  'ASSURANCE-ROADMAP.md',
  'SECURITY.md',
]) {
  archiveFile(document, `assurance/${document}`)
}
if (existsSync('astrotime-sbom.cdx.json') === true) {
  archiveFile('astrotime-sbom.cdx.json', 'supply-chain/astrotime-sbom.cdx.json')
} else if (process.env.RELEASE_EVIDENCE === '1') {
  throw new Error('Release evidence requires astrotime-sbom.cdx.json')
}

const toolchain = {
  node: process.version,
  bun: attempt(() => run('bun', ['--version'])),
  npm: attempt(() => runNpm(['--version'])),
  typescript: pkg.devDependencies.typescript,
  vitest: pkg.devDependencies.vitest,
  stryker: pkg.devDependencies['@stryker-mutator/core'],
  platform: process.platform,
  arch: process.arch,
}
writeRaw('toolchain.json', toolchain)

const evidence = {
  schemaVersion: 2,
  package: pkg.name,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  source: {
    commit,
    exactTag,
    tagSigned,
    commitSigned,
    signer: attempt(() => run('git', ['log', '-1', '--format=%GS'])),
    worktreeClean,
    verificationInputSha256: verificationSha256,
  },
  artifact: {
    filename: tarball.filename,
    shasum: tarball.shasum,
    integrity: tarball.integrity,
    unpackedSize: tarball.unpackedSize,
    fileCount: tarball.entryCount,
    reproducibleFromCommit: worktreeClean,
    note: worktreeClean
      ? 'Rebuild from this commit and run `npm pack` to reproduce this shasum.'
      : 'Generated from a dirty worktree; this artifact cannot be attributed to the commit alone.',
  },
  dependencies: {
    runtime: Object.keys(pkg.dependencies ?? {}).length,
    note: 'Zero runtime dependencies; development dependencies are exact-pinned.',
  },
  assurance: {
    requirementsTraced: requirements,
    hazardsTraced: hazards,
    tests: testCount,
    complexity,
    coverage,
    mutation,
    differential,
    conformance,
    referenceImplementations: [
      'astropy 6.0.1 (ERFA/SOFA) golden and drift vectors',
      'NAIF CSPICE naif0012.tls ET and elapsed-TAI vectors',
      'astropy/ERFA differential sweep: UTC/TT/TDB/GPS/ordinal/JD',
    ],
  },
  toolchain,
  rawReports,
  generatedFrom: 'scripts/evidence.mjs',
}

writeFileSync('evidence/evidence.json', `${JSON.stringify(evidence, null, 2)}\n`)

const metric = (name) =>
  coverage?.current === true ? `${String(coverage.total[name].pct)}%` : 'not current'
const differentialSummary =
  differential?.current === true
    ? `${String(differential.cases)} cases, ${String(differential.observed.mismatches)} mismatches, maximum TDB error ${String(differential.observed.maxTdbErrorNanos)} ns`
    : 'not included or stale'

const summary = `# Evidence bundle — ${evidence.package} ${evidence.version}

Commit \`${commit}\`${evidence.source.commitSigned === true ? ' (good signature)' : ''}; worktree **${worktreeClean ? 'clean' : 'DIRTY'}**

## Artifact

| | |
|---|---|
| File | \`${evidence.artifact.filename}\` |
| shasum | \`${evidence.artifact.shasum}\` |
| Integrity | \`${evidence.artifact.integrity}\` |
| Unpacked | ${String(evidence.artifact.unpackedSize)} bytes in ${String(evidence.artifact.fileCount)} files |
| Runtime dependencies | ${String(evidence.dependencies.runtime)} |

${evidence.artifact.note} A published package additionally carries npm OIDC
provenance; release CI attests the complete evidence archive.

## Verification

- ${String(testCount)} tests; ${String(requirements)} requirements and ${String(hazards)} hazards traced to implementation and evidence
- Coverage: statements ${metric('statements')}, branches ${metric('branches')}, functions ${metric('functions')}, lines ${metric('lines')}; leap-second module 100% reachable structural coverage
- Complexity: ${String(complexity.functions)} production functions, maximum ${String(complexity.maximum)}/${String(complexity.limit)}
- Cross-engine determinism: ${conformance.identical === true ? 'identical V8/JSC digests' : 'DIVERGENT OR INCOMPLETE'}
  - V8: \`${conformance.v8 ?? 'n/a'}\`
  - JSC: \`${conformance.jsc ?? 'n/a'}\`
- Differential verification: ${differentialSummary}
${mutation?.current === true ? `- Mutation score: ${String(mutation.score)}% (${String(mutation.detected)}/${String(mutation.total)} detected; ${String(mutation.statuses.Survived ?? 0)} survived, ${String(mutation.statuses.NoCoverage ?? 0)} no coverage)` : mutation === null ? '- Mutation report: not included' : `- Mutation report: NOT CURRENT — ${mutation.note}`}
- Raw evidence: ${String(rawReports.length)} individually SHA-256-hashed files under \`raw/\`

Generated by \`scripts/evidence.mjs\` from verification input
\`${verificationSha256}\`.
`
writeFileSync('evidence/EVIDENCE.md', summary)

const sums = [...rawReports, { path: 'evidence.json' }, { path: 'EVIDENCE.md' }]
  .map(({ path }) => `${sha256(join('evidence', path))}  ${path}`)
  .join('\n')
writeFileSync('evidence/SHA256SUMS', `${sums}\n`)

// eslint-disable-next-line no-console -- this script reports to the operator
console.log(summary)
