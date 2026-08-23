import { readFileSync, writeFileSync } from 'node:fs'
import { verificationInputHash } from './verification-inputs.mjs'

for (const report of ['coverage/coverage-final.json', 'coverage/coverage-summary.json']) {
  JSON.parse(readFileSync(report, 'utf8'))
}

writeFileSync(
  'coverage/provenance.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      inputSha256: verificationInputHash(),
      generatedAt: new Date().toISOString(),
      reports: ['coverage/coverage-final.json', 'coverage/coverage-summary.json'],
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
    },
    null,
    2,
  )}\n`,
)
