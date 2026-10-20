import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The property suite sums the 787-term TDB series millions of times and
    // approaches vitest's 5 s default under coverage on a shared CI runner.
    // Set here rather than per suite, so vitest.mutation.config.ts can raise
    // it for every test: a suite-level timeout would override that.
    testTimeout: 30_000,
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json', 'json-summary'],
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 100,
        lines: 98.5,
        'src/leap-seconds.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
