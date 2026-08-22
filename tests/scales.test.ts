import { describe, expect, it } from 'vitest'

import {
  MJD_OFFSET,
  instantFromUnixMillis,
  duration,
  formatIso,
  GPS_EPOCH_INSTANT,
  IERS_LEAP_SECONDS,
  instantFromCivil,
  instantFromGpsSeconds,
  instantFromGpsWeek,
  instantFromJ2000Nanos,
  instantFromJ2000Seconds,
  instantFromJulianDate,
  instantFromJulianDateParts,
  instantFromModifiedJulianDate,
  instantFromScaleNanos,
  instantFromScaleSeconds,
  instantFromTaiNanos,
  instantsEqual,
  instantToTaiNanos,
  instantToCivil,
  instantToGpsSeconds,
  instantToGpsWeek,
  instantToJ2000Nanos,
  instantToJ2000Seconds,
  instantToJulianDate,
  instantToJulianDateParts,
  instantToModifiedJulianDate,
  instantToScaleNanos,
  instantToScaleSeconds,
  instantToUnixSeconds,
  J2000_INSTANT,
  parseInstantOrThrow,
  TIME_SCALE_LABELS,
  TIME_SCALES,
  type TimeScale,
  truncateInstant,
  unwrap,
} from '../src/index.js'
import { expectErr } from './helpers.js'

const iso = parseInstantOrThrow

describe('J2000', () => {
  it("uses each scale's own noon as its origin (NAIF/SPICE convention for TDB)", () => {
    expect(formatIso(J2000_INSTANT, { scale: 'tt' })).toBe('2000-01-01T12:00:00.000 TT')
    expect(formatIso(J2000_INSTANT)).toBe('2000-01-01T11:58:55.816Z')
    expect(instantToJ2000Seconds(J2000_INSTANT, 'tt')).toBe(0)
    // SPICE ET = 0 at 2000-01-01T12:00:00 TDB, not TT: at TT noon, ET is the
    // (negative) TDB−TT offset, ≈ −95.8 µs from the truncated series.
    expect(instantToJ2000Nanos(J2000_INSTANT, 'tdb')).toBe(-95_757n)
    expect(instantToJ2000Nanos(parseInstantOrThrow('2000-01-01T12:00:00 TDB'), 'tdb')).toBe(0n)
    expect(instantToJ2000Nanos(parseInstantOrThrow('2000-01-01T12:00:00Z'), 'utc')).toBe(0n)
    expect(instantToJ2000Nanos(parseInstantOrThrow('2000-01-01T12:00:00 TAI'), 'tai')).toBe(0n)
    expect(instantToJ2000Nanos(parseInstantOrThrow('2000-01-01T12:00:00 GPS'), 'gps')).toBe(0n)
  })

  it("counts seconds on each scale from that scale's own noon", () => {
    for (const scale of TIME_SCALES) {
      const oneDayLater = instantFromJ2000Seconds(86_400, scale)
      expect(instantToJ2000Seconds(oneDayLater, scale)).toBe(86_400)
    }
    expect(instantToJ2000Seconds(iso('2000-01-02T12:00:00Z'), 'utc')).toBe(86_400)
  })

  it('round-trips through every scale', () => {
    const i = iso('2026-08-19T12:34:56.789012345Z')
    for (const scale of TIME_SCALES) {
      expect(instantsEqual(instantFromJ2000Nanos(instantToJ2000Nanos(i, scale), scale), i)).toBe(
        true,
      )
      expect(instantsEqual(instantFromScaleNanos(instantToScaleNanos(i, scale), scale), i)).toBe(
        true,
      )
    }
    expect(formatIso(instantFromJ2000Seconds(0.5, 'tt'), { scale: 'tt', precision: 'auto' })).toBe(
      '2000-01-01T12:00:00.500 TT',
    )
    expect(instantToScaleSeconds(iso('1970-01-01T00:00:00.5Z'), 'tai')).toBe(10.5)
    for (const scale of TIME_SCALES) {
      // Float seconds have ~240 ns double resolution at this magnitude, so
      // the float round trip is bounded, not exact (the nanos pair is exact).
      const sample = iso('2026-08-19T12:34:56.25Z')
      const back = instantFromScaleSeconds(instantToScaleSeconds(sample, scale), scale)
      const diff = instantToTaiNanos(back) - instantToTaiNanos(sample)
      expect(diff <= 240n && diff >= -240n).toBe(true)
    }
  })
})

describe('Julian dates', () => {
  it('JD 2451545.0 is J2000 on the TT scale', () => {
    expect(instantToJulianDate(J2000_INSTANT, 'tt')).toBe(2_451_545)
    expect(instantToJulianDateParts(J2000_INSTANT, 'tt')).toStrictEqual({
      jd1: 2_451_544.5,
      jd2: 0.5,
    })
    expect(instantToModifiedJulianDate(J2000_INSTANT, 'tt')).toBe(51_544.5)
  })

  it('JD 2440587.5 is the Unix epoch', () => {
    expect(instantToJulianDate(iso('1970-01-01T00:00:00Z'), 'utc')).toBe(2_440_587.5)
    expect(instantToModifiedJulianDate(iso('1970-01-01T00:00:00Z'), 'utc')).toBe(40_587)
  })

  it('round-trips with two-part precision', () => {
    const i = iso('2026-08-19T12:34:56.789012345Z')
    const { jd1, jd2 } = instantToJulianDateParts(i, 'tai')
    expect(formatIso(instantFromJulianDateParts(jd1, jd2, 'tai'), { precision: 'nanos' })).toBe(
      '2026-08-19T12:34:56.789012345Z',
    )
    expect(formatIso(instantFromJulianDate(2_451_545, 'tt'), { scale: 'tt' })).toBe(
      '2000-01-01T12:00:00.000 TT',
    )
    expect(formatIso(instantFromModifiedJulianDate(51_544.5, 'tt'), { scale: 'tt' })).toBe(
      '2000-01-01T12:00:00.000 TT',
    )
    expect(() => instantFromJulianDate(Number.NaN, 'tt')).toThrow(
      new RangeError('Julian date parts must be finite numbers'),
    )
    expect(() => instantFromJulianDateParts(200_000_000_000, 0, 'utc')).toThrow(RangeError)
  })

  it('normalizes non-canonical two-part Julian date inputs', () => {
    expect(formatIso(instantFromJulianDateParts(2_440_587.5, -0.25, 'utc'))).toBe(
      '1969-12-31T18:00:00.000Z',
    )
    expect(formatIso(instantFromJulianDateParts(2_440_587.5, 1, 'utc'))).toBe(
      '1970-01-02T00:00:00.000Z',
    )
  })

  it('UTC uses the SOFA quasi-JD convention on leap-second days (monotonic)', () => {
    const before = iso('2016-12-31T23:59:59.5Z')
    const leap = iso('2016-12-31T23:59:60.5Z')
    const after = iso('2017-01-01T00:00:00Z')
    const mjd = (i: typeof leap) => instantToModifiedJulianDate(i, 'utc')
    expect(mjd(before) < mjd(leap) && mjd(leap) < mjd(after)).toBe(true)
    expect(mjd(after)).toBe(57_754)
    expect(instantToJulianDateParts(leap, 'utc').jd1).toBe(2_457_753.5)
    expect(instantToJulianDateParts(leap, 'utc').jd2 * 86_401).toBeCloseTo(86_400.5, 6)
    // Inverse lands back inside the leap second.
    const parts = instantToJulianDateParts(leap, 'utc')
    expect(formatIso(instantFromJulianDateParts(parts.jd1, parts.jd2, 'utc'))).toBe(
      '2016-12-31T23:59:60.500Z',
    )
    expect(
      formatIso(instantFromJulianDateParts(parts.jd1, 0.25, 'utc'), { precision: 'micros' }),
    ).toBe('2016-12-31T06:00:00.250000Z')
    expect(formatIso(instantFromModifiedJulianDate(57_754, 'utc'))).toBe('2017-01-01T00:00:00.000Z')
    // Unix seconds remain POSIX (repeating) — documented, different from JD.
    expect(instantToUnixSeconds(leap)).toBe(1_483_228_800.5)
  })

  it('two-part UTC Julian dates round-trip exactly at every leap boundary', () => {
    for (const entry of IERS_LEAP_SECONDS.entries.slice(1)) {
      const boundary = BigInt(entry.unixSeconds + entry.deltaAt) * 1_000_000_000n
      for (const offset of [-1_000_000_001n, -1_000_000_000n, -999_999_999n, -1n, 0n, 1n]) {
        const instant = instantFromTaiNanos(boundary + offset)
        const parts = instantToJulianDateParts(instant, 'utc')
        expect(instantToTaiNanos(instantFromJulianDateParts(parts.jd1, parts.jd2, 'utc'))).toBe(
          boundary + offset,
        )
      }
    }
  })
})

describe('GPS', () => {
  it('epoch 1980-01-06 is week 0, second 0', () => {
    expect(instantToGpsWeek(GPS_EPOCH_INSTANT)).toStrictEqual({ week: 0, secondsOfWeek: 0 })
    expect(formatIso(GPS_EPOCH_INSTANT)).toBe('1980-01-06T00:00:00.000Z')
    expect(formatIso(instantFromGpsWeek(0, 0))).toBe('1980-01-06T00:00:00.000Z')
  })

  it('counts leap seconds (GPS − UTC = 18 s since 2017)', () => {
    const i = iso('2026-08-19T00:00:00Z')
    expect(instantToGpsWeek(i)).toStrictEqual({ week: 2432, secondsOfWeek: 259_218 })
    expect(instantsEqual(instantFromGpsWeek(2432, 259_218), i)).toBe(true)
    expect(instantsEqual(instantFromGpsSeconds(2432 * 604_800 + 259_218), i)).toBe(true)
    expect(instantToGpsSeconds(i)).toBe(2432 * 604_800 + 259_218)
    expect(instantToGpsWeek(iso('1980-01-05T23:59:59Z'))).toStrictEqual({
      week: -1,
      secondsOfWeek: 604_799,
    })
  })

  it('rejects non-integer weeks and non-finite seconds with RangeError', () => {
    expect(() => instantFromGpsWeek(1.5, 0)).toThrow(
      new RangeError('GPS week must be an integer, got 1.5'),
    )
    expect(() => instantFromGpsWeek(1, Number.NaN)).toThrow(
      new RangeError('GPS seconds of week must be a finite number, got NaN'),
    )
    expect(() => instantFromGpsSeconds(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => instantFromGpsWeek(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(RangeError)
    expect(() => instantFromGpsWeek(1, -1)).toThrow(RangeError)
    expect(() => instantFromGpsWeek(1, 604_800)).toThrow(RangeError)
    expect(() => instantToGpsWeek(instantFromTaiNanos(10n ** 100n))).toThrow(RangeError)
  })
})

describe('public scale metadata and runtime guards', () => {
  it('keeps exported scale metadata deeply immutable', () => {
    expect(Object.isFrozen(TIME_SCALES)).toBe(true)
    expect(Object.isFrozen(TIME_SCALE_LABELS)).toBe(true)
    expect(() => (TIME_SCALES as unknown as string[]).push('bad')).toThrow(TypeError)
    expect(() => {
      ;(TIME_SCALE_LABELS as unknown as { tai: string }).tai = 'BAD'
    }).toThrow(TypeError)
  })

  it('rejects invalid runtime scale and truncation-unit values with RangeError', () => {
    const instant = iso('2026-08-19T00:00:00Z')
    expect(() => instantToScaleNanos(instant, 'bad' as TimeScale)).toThrow(RangeError)
    expect(() => instantFromCivil({ year: 2026, month: 1, day: 1 }, 'bad' as TimeScale)).toThrow(
      RangeError,
    )
    expect(() => truncateInstant(instant, 'bad' as never, 'utc')).toThrow(RangeError)
  })
})

describe('civil time in uniform scales', () => {
  it('reads the TAI clock', () => {
    expect(instantToCivil(iso('2016-12-31T23:59:60.25Z'), 'tai')).toStrictEqual({
      year: 2017,
      month: 1,
      day: 1,
      dayOfYear: 1,
      hour: 0,
      minute: 0,
      second: 36,
      nanosecond: 250_000_000,
    })
  })

  it.each(TIME_SCALES)('round-trips civil fields on %s', (scale: TimeScale) => {
    const fields = {
      year: 2026,
      month: 8,
      day: 19,
      hour: 12,
      minute: 34,
      second: 56,
      nanosecond: 789,
    }
    const i = unwrap(instantFromCivil(fields, scale))
    expect(instantToCivil(i, scale)).toStrictEqual({ ...fields, dayOfYear: 231 })
  })

  it('rejects second 60 on uniform scales and propagates field errors', () => {
    expect(
      expectErr(
        instantFromCivil(
          { year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 },
          'gps',
        ),
      ).reason,
    ).toBe('GPS has no leap seconds')
    expect(expectErr(instantFromCivil({ year: 2016, month: 13, day: 1 }, 'tai')).field).toBe(
      'month',
    )
  })
})

describe('TDB', () => {
  it('stays within its amplitude bound and inverts modern sample readings', () => {
    for (const month of [1, 4, 7, 10]) {
      const i = unwrap(instantFromCivil({ year: 2026, month, day: 1 }, 'utc'))
      const diff = Number(instantToScaleNanos(i, 'tdb') - instantToScaleNanos(i, 'tt'))
      expect(Math.abs(diff)).toBeLessThanOrEqual(1_700_000)
      expect(instantsEqual(instantFromScaleNanos(instantToScaleNanos(i, 'tdb'), 'tdb'), i)).toBe(
        true,
      )
    }
    // A case where the single-evaluation inverse was off by 1 ns.
    const tricky = instantFromScaleNanos(
      instantToScaleNanos(iso('1966-11-05T19:19:54.794626658Z'), 'tdb'),
      'tdb',
    )
    expect(formatIso(tricky, { precision: 'nanos' })).toBe('1966-11-05T19:19:54.794626658Z')
  })

  it('bounds an unavoidable TDB lattice collision to one nanosecond', () => {
    // At this rounding boundary the decreasing TDB−TT offset maps adjacent
    // TT nanoseconds to the same TDB nanosecond. No inverse can recover both.
    const before = instantFromTaiNanos(954_817_935_924_574_570n)
    const after = instantFromTaiNanos(954_817_935_924_574_571n)
    const tdbNanos = instantToScaleNanos(before, 'tdb')
    expect(instantToScaleNanos(after, 'tdb')).toBe(tdbNanos)

    const canonical = instantToTaiNanos(instantFromScaleNanos(tdbNanos, 'tdb'))
    expect(canonical - instantToTaiNanos(before)).toBe(1n)
    expect(canonical - instantToTaiNanos(after)).toBe(0n)

    const { jd1, jd2 } = instantToJulianDateParts(before, 'tdb')
    expect(instantToTaiNanos(instantFromJulianDateParts(jd1, jd2, 'tdb')) - canonical).toBe(0n)
  })

  it('chooses a closest TT reading for an unrepresentable TDB nanosecond', () => {
    // At an increasing-offset boundary the forward map jumps by 2 ns, so the
    // TDB nanosecond between these values has no exact TT preimage.
    const before = instantFromTaiNanos(970_754_996_798_492_621n)
    const after = instantFromTaiNanos(970_754_996_798_492_622n)
    const beforeTdb = instantToScaleNanos(before, 'tdb')
    const afterTdb = instantToScaleNanos(after, 'tdb')
    expect(afterTdb - beforeTdb).toBe(2n)

    const gap = beforeTdb + 1n
    const closest = instantFromScaleNanos(gap, 'tdb')
    const residual = instantToScaleNanos(closest, 'tdb') - gap
    expect(residual === -1n || residual === 1n).toBe(true)
  })

  it('rejects TDB readings beyond the supported civil range', () => {
    expect(() => instantToScaleNanos(instantFromTaiNanos(10n ** 30n), 'tdb')).toThrow(RangeError)
    expect(() => instantFromScaleNanos(10n ** 30n, 'tdb')).toThrow(RangeError)
  })
})

describe('truncateInstant', () => {
  const i = iso('2026-08-19T12:34:56.789012345Z')
  it.each([
    ['day', '2026-08-19T00:00:00.000000000Z'],
    ['hour', '2026-08-19T12:00:00.000000000Z'],
    ['minute', '2026-08-19T12:34:00.000000000Z'],
    ['second', '2026-08-19T12:34:56.000000000Z'],
    ['millisecond', '2026-08-19T12:34:56.789000000Z'],
    ['microsecond', '2026-08-19T12:34:56.789012000Z'],
  ] as const)('%s on UTC', (unit, expected) => {
    expect(formatIso(truncateInstant(i, unit, 'utc'), { precision: 'nanos' })).toBe(expected)
  })

  it('is scale-aware (TAI day boundary ≠ UTC day boundary)', () => {
    expect(formatIso(truncateInstant(i, 'day', 'tai'), { scale: 'tai' })).toBe(
      '2026-08-19T00:00:00.000 TAI',
    )
    expect(formatIso(truncateInstant(i, 'day', 'tai'))).toBe('2026-08-18T23:59:23.000Z')
    expect(formatIso(truncateInstant(i, 'hour', 'gps'), { scale: 'gps' })).toBe(
      '2026-08-19T12:00:00.000 GPS',
    )
  })

  it('stays inside a leap second for fine units and lands on the same day for coarse ones', () => {
    const leap = iso('2016-12-31T23:59:60.5Z')
    expect(formatIso(truncateInstant(leap, 'second', 'utc'))).toBe('2016-12-31T23:59:60.000Z')
    expect(formatIso(truncateInstant(leap, 'millisecond', 'utc'))).toBe('2016-12-31T23:59:60.500Z')
    expect(formatIso(truncateInstant(leap, 'minute', 'utc'))).toBe('2016-12-31T23:59:00.000Z')
    expect(formatIso(truncateInstant(leap, 'day', 'utc'))).toBe('2016-12-31T00:00:00.000Z')
    expect(formatIso(truncateInstant(iso('2017-01-01T00:00:00.5Z'), 'day', 'utc'))).toBe(
      '2017-01-01T00:00:00.000Z',
    )
  })

  it('handles negative (pre-1970) instants', () => {
    expect(formatIso(truncateInstant(iso('1969-12-31T23:59:59.5Z'), 'day', 'utc'))).toBe(
      '1969-12-31T00:00:00.000Z',
    )
    expect(formatIso(truncateInstant(iso('1969-12-31T23:59:59.5Z'), 'second', 'tai'))).toBe(
      '1969-12-31T23:59:59.000Z',
    )
    expect(duration({ seconds: 1 }).nanos).toBe(1_000_000_000n)
  })
})

describe('modified Julian date precision', () => {
  // instantToModifiedJulianDate subtracts the offset from the high part of
  // the two-part JD before adding the low part. Rewriting it as
  // instantToJulianDate(...) - MJD_OFFSET collapses the pair first and costs
  // roughly an order of magnitude of round-trip accuracy. This test exists so
  // that "simplification" fails rather than silently degrades the result.
  const i = instantFromUnixMillis(1_787_142_896_789)

  it.each(['utc', 'tai', 'tt'] as const)('round-trips within 1 us on %s', (scale) => {
    const mjd = instantToModifiedJulianDate(i, scale)
    const back = instantFromModifiedJulianDate(mjd, scale)
    const errorNanos = Number(instantToTaiNanos(back) - instantToTaiNanos(i))
    expect(Math.abs(errorNanos)).toBeLessThan(1_000)
  })

  it('beats collapsing the two-part value first', () => {
    const mjd = instantToModifiedJulianDate(i, 'tai')
    const collapsed = instantToJulianDate(i, 'tai') - MJD_OFFSET
    const err = (m: number): number =>
      Math.abs(
        Number(instantToTaiNanos(instantFromModifiedJulianDate(m, 'tai')) - instantToTaiNanos(i)),
      )
    expect(err(mjd)).toBeLessThan(err(collapsed))
  })
})
