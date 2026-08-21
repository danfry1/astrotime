import { describe, expect, it } from 'vitest'

import {
  duration,
  formatIso,
  GPS_EPOCH_INSTANT,
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
  instantsEqual,
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
    // (negative) TDB−TT offset, ≈ −92.7 µs from the truncated series.
    expect(instantToJ2000Nanos(J2000_INSTANT, 'tdb')).toBe(-92_704n)
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
      const sample = iso('2026-08-19T12:34:56.25Z')
      expect(
        instantsEqual(instantFromScaleSeconds(instantToScaleSeconds(sample, scale), scale), sample),
      ).toBe(true)
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
  it('differs from TT by at most 1.7 ms and round-trips exactly', () => {
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
