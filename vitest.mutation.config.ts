import { defineConfig, mergeConfig } from 'vitest/config'

import base from './vitest.config.js'

/**
 * The suite as Stryker runs it. Its instrumented build is more than a hundred
 * times slower through the TDB and nutation series, so a test that takes
 * 40 ms normally exceeds vitest's 5 s default and fails the dry run. The
 * tests are unchanged; only the per-test limit is raised.
 */
export default mergeConfig(base, defineConfig({ test: { testTimeout: 60_000 } }))
