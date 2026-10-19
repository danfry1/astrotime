import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  equationOfTheEquinoxes,
  instantFromTaiNanos,
  J2000_INSTANT,
  meanObliquity,
  nutation,
} from '../src/index.js'
import {
  EQUINOX_COMPLEMENTARY,
  NUTATION_LUNI_SOLAR,
  NUTATION_PLANETARY,
} from '../src/nutation-series.js'
import reference from './fixtures/erfa-nutation.json' with { type: 'json' }

type Row = {
  ttDaysSinceJ2000: number
  dpsi: number
  deps: number
  obliquity: number
  complementary: number
  equationOfEquinoxes: number
}

const rows = reference.rows as Row[]
const at = (row: Row) =>
  instantFromTaiNanos(J2000_INSTANT.taiNanos + BigInt(Math.round(row.ttDaysSinceJ2000 * 86_400e9)))
const ARCSEC = Math.PI / 648_000

describe('IAU 2006/2000A nutation, obliquity and equation of the equinoxes', () => {
  it('carries the IAU 2000A tables exactly as generated from ERFA', () => {
    expect(NUTATION_LUNI_SOLAR.length).toBe(678 * 11)
    expect(NUTATION_PLANETARY.length).toBe(687 * 17)
    expect(EQUINOX_COMPLEMENTARY.length).toBe(34 * 10)
    // SHA-256 of the shortest round-trip decimal forms (engine-independent);
    // regenerating from the pinned ERFA sources reproduces it.
    const canonical = [NUTATION_LUNI_SOLAR, NUTATION_PLANETARY, EQUINOX_COMPLEMENTARY]
      .map((table) => Array.from(table, String).join(','))
      .join(';')
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(
      'b643c1528dbd042deb4e80da1bd105efee178080836b2d912dd88ab9ab56d698',
    )
  })

  it('reproduces ERFA nut06a within 1e-14 rad from 1800 to 2200', () => {
    // Same 1 365 terms in the same order; only the deterministic sine and
    // cosine differ from libm (measured worst case 4.9e-16 rad).
    for (const row of rows) {
      const { dpsi, deps } = nutation(at(row))
      expect(Math.abs(dpsi - row.dpsi)).toBeLessThan(1e-14)
      expect(Math.abs(deps - row.deps)).toBeLessThan(1e-14)
    }
    expect(rows).toHaveLength(500)
  })

  it('reproduces ERFA obl06 and the eect00 complementary terms', () => {
    for (const row of rows) {
      const instant = at(row)
      expect(Math.abs(meanObliquity(instant) - row.obliquity)).toBeLessThan(1e-15)
      // Recover the complementary terms from the composition with ERFA's own parts.
      const fromErfaParts = row.dpsi * Math.cos(row.obliquity) + row.complementary
      expect(Math.abs(equationOfTheEquinoxes(instant) - fromErfaParts)).toBeLessThan(1e-14)
    }
  })

  it('agrees with ERFA ee06a, derived through the full precession-nutation matrix, within 3.1 µas', () => {
    let worst = 0
    for (const row of rows) {
      worst = Math.max(worst, Math.abs(equationOfTheEquinoxes(at(row)) - row.equationOfEquinoxes))
    }
    expect(worst).toBeLessThan(1.5e-11)
  })

  it('has the textbook magnitudes at J2000.0', () => {
    const { dpsi, deps } = nutation(J2000_INSTANT)
    // The 18.6-year term dominates: |Δψ| ≤ ~17.3″, |Δε| ≤ ~9.3″.
    expect(Math.abs(dpsi) / ARCSEC).toBeLessThan(17.5)
    expect(Math.abs(deps) / ARCSEC).toBeLessThan(9.5)
    // ε_A at J2000.0 is 84 381.406″ exactly by the IAU 2006 definition.
    expect(meanObliquity(J2000_INSTANT) / ARCSEC).toBeCloseTo(84_381.406, 9)
  })
})
