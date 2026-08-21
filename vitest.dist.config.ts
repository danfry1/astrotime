import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Runs the whole test suite against the built artifact instead of `src/`,
 * so a packaging or bundling defect (a dropped export, a mangled entry, a
 * tree-shaken side effect) cannot pass unnoticed. `sha1.ts` is internal and
 * not exported from the package entry, so it stays pointed at source.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    alias: {
      '../src/index.js': path.resolve(import.meta.dirname, 'dist/index.mjs'),
    },
  },
})
