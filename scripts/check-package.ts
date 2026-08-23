/**
 * Packs the library exactly as npm would and imports the tarball from a
 * throw-away directory, so a broken `exports` map or missing file fails CI.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const workDir = mkdtempSync(join(tmpdir(), 'astrotime-pack-'))
const npmEnv = { ...process.env, npm_config_cache: join(workDir, '.npm-cache') }
try {
  const tarball = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', workDir], {
    cwd: root,
    encoding: 'utf8',
    env: npmEnv,
  })
    .trim()
    .split('\n')
    .at(-1)
  if (tarball === undefined) throw new Error('npm pack produced no tarball')
  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify({ name: 'smoke', type: 'module', private: true }),
  )
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(workDir, tarball)],
    { cwd: workDir, env: npmEnv, stdio: 'inherit' },
  )
  const script = `
    import { parseInstant, formatIso, unwrap, deltaAt } from 'astrotime'
    const i = unwrap(parseInstant('2016-12-31T23:59:60.5Z'))
    const tai = formatIso(i, { scale: 'tai', precision: 'auto' })
    if (tai !== '2017-01-01T00:00:36.500 TAI' || deltaAt(i) !== 36) throw new Error('smoke test failed: ' + tai)
    console.log('astrotime package smoke test passed on', typeof Bun === 'undefined' ? process.version : 'bun ' + Bun.version)
  `
  writeFileSync(join(workDir, 'smoke.mjs'), script)
  // Run under Node explicitly (when this script runs under bun, process.execPath is bun),
  // then under Bun when available, so both claimed runtimes execute the packed artifact.
  execFileSync('node', ['smoke.mjs'], { cwd: workDir, stdio: 'inherit' })
  try {
    execFileSync('bun', ['smoke.mjs'], { cwd: workDir, stdio: 'inherit' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    console.log('bun not found on PATH; skipped Bun smoke run')
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
