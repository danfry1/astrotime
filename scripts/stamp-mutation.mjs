import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { verificationInputHash } from './verification-inputs.mjs'

const reportPath = 'reports/mutation/mutation.json'
JSON.parse(readFileSync(reportPath, 'utf8'))

mkdirSync('reports/mutation', { recursive: true })
writeFileSync(
  'reports/mutation/provenance.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      inputSha256: verificationInputHash(),
      generatedAt: new Date().toISOString(),
      report: reportPath,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
    },
    null,
    2,
  )}\n`,
)
