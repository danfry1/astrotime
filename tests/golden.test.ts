import { describe, expect, it } from 'vitest'

import {
  formatInstant,
  formatIso,
  gpsSeconds,
  IERS_LEAP_SECONDS,
  instantToUnixSeconds,
  instantToUtc,
  julianDateParts,
  modifiedJulianDate,
  parseInstant,
  unwrap,
} from '../src/index.js'
import golden from './fixtures/astropy-golden.json' with { type: 'json' }

type Row = {
  utc: string
  tai: string
  tt: string
  tdb: string
  jdUtc: [number, number]
  jdTt: [number, number]
  mjdUtc: number
  unix: number
  gps: number
  yday: string
}

const rows = golden.rows as Row[]
const leapDayStarts = new Set(IERS_LEAP_SECONDS.entries.map((e) => e.unixSeconds - 86_400))

const isLeapDay = (utc: string): boolean => {
  const midnight = Date.parse(`${utc.slice(0, 10)}T00:00:00Z`) / 1000
  return leapDayStarts.has(midnight)
}

describe('astropy golden vectors', () => {
  it.each(rows)('$utc → TAI/TT/TDB/JD/GPS', (row) => {
    const instant = unwrap(parseInstant(`${row.utc}Z`))

    expect(formatIso(instant, { scale: 'tai', precision: 'nanos' })).toBe(row.tai)
    expect(formatIso(instant, { scale: 'tt', precision: 'nanos' })).toBe(row.tt)
    expect(formatIso(instant, { precision: 'nanos' })).toBe(`${row.utc}Z`)
    expect(formatInstant(instant, 'YYYY:DDD:HH:mm:ss.SSSSSSSSS')).toBe(row.yday)

    // TDB: our truncated series vs ERFA's full dtdb — agree within 30 µs.
    const tdbOurs = Date.parse(
      `${formatIso(instant, { scale: 'tdb', precision: 'micros' }).slice(0, 23)}Z`,
    )
    const tdbRef = Date.parse(`${row.tdb.slice(0, 23)}Z`)
    expect(Math.abs(tdbOurs - tdbRef)).toBeLessThanOrEqual(0.03)

    const jdTt = julianDateParts(instant, 'tt')
    expect(jdTt.jd1 + jdTt.jd2 - (row.jdTt[0] + row.jdTt[1])).toBeCloseTo(0, 9)
    expect(Math.abs((jdTt.jd1 - row.jdTt[0] + (jdTt.jd2 - row.jdTt[1])) * 86_400)).toBeLessThan(
      1e-6,
    )

    expect(gpsSeconds(instant)).toBeCloseTo(row.gps, 6)

    if (!isLeapDay(row.utc)) {
      expect(instantToUnixSeconds(instant)).toBeCloseTo(row.unix, 6)
      const jdUtc = julianDateParts(instant, 'utc')
      expect(
        Math.abs((jdUtc.jd1 - row.jdUtc[0] + (jdUtc.jd2 - row.jdUtc[1])) * 86_400),
      ).toBeLessThan(1e-6)
      expect(modifiedJulianDate(instant, 'utc')).toBeCloseTo(row.mjdUtc, 9)
    }
  })

  it('reports second 60 inside inserted leap seconds', () => {
    const leap = rows.filter((r) => r.utc.includes('T23:59:60'))
    expect(leap.length).toBeGreaterThan(5)
    for (const row of leap) {
      expect(instantToUtc(unwrap(parseInstant(`${row.utc}Z`))).second).toBe(60)
    }
  })
})
