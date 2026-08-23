import { readFileSync, writeFileSync } from 'node:fs'
import { verificationInputHash } from './verification-inputs.mjs'

const report = 'reports/differential/report.json'
JSON.parse(readFileSync(report, 'utf8'))

writeFileSync(
  'reports/differential/provenance.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      inputSha256: verificationInputHash(['scripts/differential.py']),
      generatedAt: new Date().toISOString(),
      report,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
    },
    null,
    2,
  )}\n`,
)
