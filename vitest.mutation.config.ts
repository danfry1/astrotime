import { defineConfig, mergeConfig } from 'vitest/config'

import base from './vitest.config.js'

/**
 * The suite as Stryker runs it. Its instrumented build is up to a hundred
 * times slower through the TDB and nutation series: a topocentric test that
 * takes 40 ms normally exceeded 5 s, and a property test that takes under a
 * second exceeded 30 s. The tests are unchanged; only the per-test limit is
 * raised. No test may set its own timeout, since that would take precedence
 * over this one.
 */
export default mergeConfig(base, defineConfig({ test: { testTimeout: 300_000 } }))
