import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const INPUTS = [
  'src',
  'tests',
  'vitest.config.ts',
  'tsconfig.json',
  'stryker.config.json',
  'package.json',
  'bun.lock',
]

/** @param {string} path @returns {string[]} */
function filesBelow(path) {
  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() === true ? filesBelow(child) : [child]
  })
}

/** Stable digest of every input that can affect the mutation result. */
export function verificationInputHash() {
  const files = INPUTS.flatMap((path) =>
    path === 'src' || path === 'tests' ? filesBelow(path) : [path],
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}
