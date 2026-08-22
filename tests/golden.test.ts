import { describe, expect, it } from 'vitest'

import {
  formatInstant,
  formatIso,
  IERS_LEAP_SECONDS,
  instantToGpsSeconds,
  instantToJulianDateParts,
  instantToModifiedJulianDate,
  instantToUnixSeconds,
  instantToUtc,
  parseInstantOrThrow,
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
const isLeapDay = (utc: string): boolean =>
  leapDayStarts.has(Date.parse(`${utc.slice(0, 10)}T00:00:00Z`) / 1000)
/** Nanoseconds since epoch for a 'YYYY-MM-DDTHH:mm:ss.fffffffff' string on a uniform calendar. */
function isoToEpochNanos(text: string): bigint {
  const wholeSeconds = BigInt(Date.parse(`${text.slice(0, 19)}Z`) / 1000)
  const fraction = text.slice(20).padEnd(9, '0')
  return wholeSeconds * 1_000_000_000n + BigInt(fraction === '' ? 0 : fraction)
}

const jdDiffSeconds = (ours: { jd1: number; jd2: number }, ref: [number, number]): number =>
  Math.abs((ours.jd1 - ref[0] + (ours.jd2 - ref[1])) * 86_400)

function tdbErrorNanos(row: Row): bigint {
  const instant = parseInstantOrThrow(`${row.utc}Z`)
  const ours = isoToEpochNanos(
    formatIso(instant, { scale: 'tdb', precision: 'nanos', designator: 'none' }),
  )
  const reference = isoToEpochNanos(row.tdb)
  return ours > reference ? ours - reference : reference - ours
}

describe('astropy golden vectors', () => {
  it.each(rows)('$utc → TAI/TT/TDB/JD/GPS', (row) => {
    const instant = parseInstantOrThrow(`${row.utc}Z`)

    expect(formatIso(instant, { scale: 'tai', precision: 'nanos', designator: 'none' })).toBe(
      row.tai,
    )
    expect(formatIso(instant, { scale: 'tt', precision: 'nanos', designator: 'none' })).toBe(row.tt)
    expect(formatIso(instant, { precision: 'nanos' })).toBe(`${row.utc}Z`)
    expect(formatInstant(instant, 'YYYY:DDD:HH:mm:ss.SSSSSSSSS')).toBe(row.yday)

    // TDB: our seven-term series vs ERFA's full dtdb — agree within 10 µs,
    // compared at full nanosecond precision (no millisecond truncation).
    expect(tdbErrorNanos(row) <= 10_000n).toBe(true)

    expect(jdDiffSeconds(instantToJulianDateParts(instant, 'tt'), row.jdTt)).toBeLessThan(1e-9)
    // UTC JD follows the SOFA quasi-JD convention, which astropy implements too — valid on leap days as well.
    expect(jdDiffSeconds(instantToJulianDateParts(instant, 'utc'), row.jdUtc)).toBeLessThan(1e-9)
    expect(instantToModifiedJulianDate(instant, 'utc')).toBeCloseTo(row.mjdUtc, 8)
    expect(instantToGpsSeconds(instant)).toBeCloseTo(row.gps, 6)
  })

  it.each(rows.filter((r) => !isLeapDay(r.utc)))(
    '$utc → Unix seconds (POSIX, non-leap days)',
    (row) => {
      expect(instantToUnixSeconds(parseInstantOrThrow(`${row.utc}Z`))).toBeCloseTo(row.unix, 6)
    },
  )

  it.each(rows.filter((r) => r.utc.includes('T23:59:60')))('$utc reports second 60', (row) => {
    expect(instantToUtc(parseInstantOrThrow(`${row.utc}Z`)).second).toBe(60)
  })

  it('TDB agrees with ERFA within 10 µs across all golden epochs', () => {
    expect(
      rows.reduce((maximum, row) => {
        const error = tdbErrorNanos(row)
        return error > maximum ? error : maximum
      }, 0n),
    ).toBeLessThanOrEqual(10_000n)
  })
})
