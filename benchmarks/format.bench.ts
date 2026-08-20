// vitest bench: `bunx vitest bench --run benchmarks/`
import { bench, describe } from 'vitest'
import {
  formatInstant,
  formatIso,
  formatOrdinal,
  instantFromUnixMillis,
  instantToUnixMillis,
  instantToUtc,
  parseInstant,
} from '../src/index.js'

const N = 4096
const base = Date.UTC(2025, 5, 15, 12, 0, 0)
const msArr = Array.from({ length: N }, (_, i) => base + i * 137 + (i % 7) * 1000)
let k = 0
function cycle<T>(values: readonly T[]): () => T {
  return () => {
    const value = values[(k = (k + 1) & (N - 1))]
    if (value === undefined) throw new Error('unreachable: cycle index in range')
    return value
  }
}
const nextMs = cycle(msArr)
const instArr = msArr.map((ms) => instantFromUnixMillis(ms))
const nextInst = cycle(instArr)
const isoStrs = instArr.map((i) => formatIso(i))
const nextIso = cycle(isoStrs)
const PAT = 'YYYY-MM-DD HH:mm:ss.SSS'

describe('format', () => {
  bench('formatInstant(instantFromUnixMillis(ms), PAT)', () => {
    formatInstant(instantFromUnixMillis(nextMs()), PAT)
  })
  bench('formatIso(inst)', () => {
    formatIso(nextInst())
  })
  bench('formatOrdinal(inst)', () => {
    formatOrdinal(nextInst())
  })
  bench('native Date#toISOString', () => {
    new Date(nextMs()).toISOString()
  })
})

describe('convert', () => {
  bench('instantFromUnixMillis -> instantToUnixMillis', () => {
    instantToUnixMillis(instantFromUnixMillis(nextMs()))
  })
  bench('instantToUtc(inst)', () => {
    instantToUtc(nextInst())
  })
})

describe('parse', () => {
  bench('parseInstant(iso)', () => {
    parseInstant(nextIso())
  })
  bench('parseInstant(text, {format: PAT})', () => {
    parseInstant(nextIso(), { format: 'YYYY-MM-DD[T]HH:mm:ss.SSSZ' })
  })
  bench('native Date.parse(iso)', () => {
    Date.parse(nextIso())
  })
})
