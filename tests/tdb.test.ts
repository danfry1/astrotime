import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { fairheadBretagnonTdbMinusTt } from '../src/tdb.js'
import { FAIRHEAD_BRETAGNON_BLOCKS, FAIRHEAD_BRETAGNON_TERMS } from '../src/tdb-series.js'
import dtdb from './fixtures/erfa-dtdb.json' with { type: 'json' }

type Row = { ttDaysSinceJ2000: number; tdbMinusTt: number }

const rows = dtdb.rows as Row[]
/**
 * The series is evaluated term by term in ERFA's order with the same doubles;
 * only the sine differs (a deterministic polynomial here, libm in ERFA). The
 * measured worst case over 1600–2500 is ~1e-14 s, so 1e-13 s leaves headroom
 * for engine differences while staying four orders below a nanosecond.
 */
const FIDELITY_SECONDS = 1e-13

describe('Fairhead & Bretagnon TDB series', () => {
  it('carries all 787 ERFA terms in five power-of-T blocks', () => {
    expect(FAIRHEAD_BRETAGNON_TERMS.length).toBe(787 * 3)
    expect([...FAIRHEAD_BRETAGNON_BLOCKS]).toEqual([0, 474, 679, 764, 784, 787])
    // The leading annual term, as published by Fairhead & Bretagnon (1990).
    expect([...FAIRHEAD_BRETAGNON_TERMS.subarray(0, 3)]).toEqual([
      1656.674564e-6, 6283.075849991, 6.240054195,
    ])
  })

  it('keeps the coefficient table exactly as generated from ERFA', () => {
    // SHA-256 of the doubles' shortest round-trip decimal forms (specified by
    // ECMAScript, so engine-independent). Regenerating from the pinned ERFA
    // source reproduces it; any hand edit to a coefficient changes it.
    const canonical = Array.from(FAIRHEAD_BRETAGNON_TERMS, String).join(',')
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(
      '58628e66a143ca0ef134cbcabcac9fc6ef4956af2e761947a1c375652da817cf',
    )
  })

  it('reproduces ERFA dtdb within 1e-13 s from 1600 to 2500', () => {
    const worst = rows.reduce(
      (maximum, row) =>
        Math.max(
          maximum,
          Math.abs(fairheadBretagnonTdbMinusTt(row.ttDaysSinceJ2000) - row.tdbMinusTt),
        ),
      0,
    )
    expect(rows.length).toBe(1000)
    expect(worst).toBeLessThanOrEqual(FIDELITY_SECONDS)
  })
})
