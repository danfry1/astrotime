import { describe, expect, it } from 'vitest'

import { formatInstant, formatIso, instantToGpsSeconds, instantFromTaiNanos } from '../src/index.js'
import drift from './fixtures/astropy-drift.json' with { type: 'json' }

type Row = { taiNanos: string; utc: string; tt: string; gps: number; yday: string }

/**
 * Seeded random instants plus ±1 ns / ±0.5 s / ±1 s probes around every
 * leap-second boundary, checked against astropy (ERFA/SOFA). Regenerate with
 * `python3 scripts/generate-drift.py > tests/fixtures/astropy-drift.json`.
 */
describe('no drift from astropy', () => {
  const rows = drift.rows as Row[]

  it('covers random instants and every leap boundary', () => {
    expect(rows.length).toBe(400 + 27 * 8)
  })

  it('matches UTC, TT, GPS and day-of-year readings on every row', () => {
    const mismatches: string[] = []
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      const utc = formatIso(instant, { precision: 'nanos' }).slice(0, -1)
      const tt = formatIso(instant, { scale: 'tt', precision: 'nanos', designator: 'none' })
      const yday = formatInstant(instant, 'YYYY:DDD:HH:mm:ss.SSSSSSSSS')
      const gpsError = Math.abs(instantToGpsSeconds(instant) - row.gps)
      if (utc !== row.utc || tt !== row.tt || yday !== row.yday || gpsError > 1e-6) {
        mismatches.push(
          `${row.taiNanos}: ours ${utc}/${tt}/${yday} vs astropy ${row.utc}/${row.tt}/${row.yday}`,
        )
      }
    }
    expect(mismatches).toStrictEqual([])
  })
})
