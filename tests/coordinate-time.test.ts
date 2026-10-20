import { describe, expect, it } from 'vitest'

import {
  formatIso,
  instantFromScaleNanos,
  instantFromTaiNanos,
  instantToScaleNanos,
  instantToTaiNanos,
  parseInstantOrThrow,
} from '../src/index.js'
import coordinate from './fixtures/coordinate-times.json' with { type: 'json' }

type Row = { taiNanos: string; tcgExact: string; tcgAstropy?: string; tcbAstropy?: string }

const rows = coordinate.rows as Row[]
const modern = rows.filter((row) => row.tcgAstropy !== undefined)

/** Nanosecond distance between two readings of the same scale. */
const readingNanos = (text: string, scale: 'TCG' | 'TCB'): bigint =>
  instantToTaiNanos(parseInstantOrThrow(`${text} ${scale}`))

describe('TCG and TCB', () => {
  it('reads TCG exactly as the IAU definition gives it, across the civil range', () => {
    // tcgExact is the definition in exact rational arithmetic (the generator
    // uses neither astropy nor astrotime), so equality is the contract.
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      expect(instantToScaleNanos(instant, 'tcg')).toBe(BigInt(row.tcgExact))
    }
    expect(rows.length).toBe(500)
  })

  it('agrees with astropy TCG and TCB within one nanosecond', () => {
    for (const row of modern) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      for (const [scale, label, reference] of [
        ['tcg', 'TCG', row.tcgAstropy],
        ['tcb', 'TCB', row.tcbAstropy],
      ] as const) {
        const ours = formatIso(instant, { scale, precision: 'nanos', designator: 'none' })
        const difference = readingNanos(ours, label) - readingNanos(reference ?? '', label)
        expect(difference >= -1n && difference <= 1n).toBe(true)
      }
    }
    expect(modern.length).toBe(400)
  })

  it('meets TT at T0 and runs faster by L_G', () => {
    const t0 = parseInstantOrThrow('1977-01-01T00:00:32.184 TT')
    expect(formatIso(t0, { scale: 'tcg', precision: 'nanos' })).toBe(
      '1977-01-01T00:00:32.184000000 TCG',
    )
    // L_G × 86 400 s = 60.2146667577… µs per day.
    const later = parseInstantOrThrow('1977-01-02T00:00:32.184 TT')
    expect(instantToScaleNanos(later, 'tcg') - instantToScaleNanos(later, 'tt')).toBe(60_215n)
    // TCB at T0 is TDB − TDB0: 65.5 µs ahead of TDB by definition.
    expect(instantToScaleNanos(t0, 'tcb') - instantToScaleNanos(t0, 'tdb')).toBe(65_500n)
  })

  it('round-trips TCG and TCB exactly from every instant', () => {
    // Both run faster than TT (TCB because L_B exceeds TDB − TT's largest
    // rate), so each TT nanosecond has its own reading on either scale.
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      for (const scale of ['tcg', 'tcb'] as const) {
        const back = instantFromScaleNanos(instantToScaleNanos(instant, scale), scale)
        expect(instantToTaiNanos(back)).toBe(instantToTaiNanos(instant))
      }
    }
  })

  it('resolves a TCG reading between two TT nanoseconds to the nearer one', () => {
    // TCG gains a nanosecond on TT every ~1.43 s, so some TCG readings have no
    // exact TT preimage; the inverse lands within half a TT nanosecond.
    // TCG − TT only ever steps up by one, so bisect a 2 s window for the step.
    const offset = (tai: bigint) => instantToScaleNanos(instantFromTaiNanos(tai), 'tcg') - tai
    let low = 1_000_000_000_000_000_000n
    let high = low + 2_000_000_000n
    expect(offset(high) - offset(low)).toBeGreaterThan(0n)
    while (high - low > 1n) {
      const middle = (low + high) / 2n
      if (offset(middle) === offset(low)) low = middle
      else high = middle
    }
    const here = instantToScaleNanos(instantFromTaiNanos(low), 'tcg')
    expect(instantToScaleNanos(instantFromTaiNanos(high), 'tcg') - here).toBe(2n)
    const gap = here + 1n
    const resolved = instantFromScaleNanos(gap, 'tcg')
    const residual = instantToScaleNanos(resolved, 'tcg') - gap
    expect(residual === -1n || residual === 1n).toBe(true)
  })

  it('parses and formats TCG and TCB designators', () => {
    const instant = parseInstantOrThrow('2026-08-19T12:00:00.000000000 TCB')
    expect(formatIso(instant, { scale: 'tcb', precision: 'nanos' })).toBe(
      '2026-08-19T12:00:00.000000000 TCB',
    )
    expect(formatIso(parseInstantOrThrow('2026-231T12:00:00 TCG'), { scale: 'tcg' })).toBe(
      '2026-08-19T12:00:00.000 TCG',
    )
  })
})
