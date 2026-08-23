// Applies the same class transform Metro applies, then prepends the console
// shim Hermes needs (it has no console of its own). Kept as a script rather
// than an inline `node -e` so the Babel plugins resolve from the lockfile-
// pinned devDependencies instead of an unpinned, ad-hoc `npm install`.
import { readFileSync, writeFileSync } from 'node:fs'

import { transformSync } from '@babel/core'
import classProperties from '@babel/plugin-transform-class-properties'
import classes from '@babel/plugin-transform-classes'

const [input, output] = process.argv.slice(2)
if (input === undefined || output === undefined) {
  throw new Error('usage: hermes-transform.mjs <input.js> <output.js>')
}

const result = transformSync(readFileSync(input, 'utf8'), {
  plugins: [classProperties, classes],
  configFile: false,
  babelrc: false,
})
const code = result?.code
if (typeof code !== 'string') throw new Error(`Babel produced no output for ${input}`)

writeFileSync(output, `var console={log:function(m){print(m);}};\n${code}`)
