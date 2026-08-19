import { describe, expect, it } from 'vitest'

import {
  addDuration,
  compareInstants,
  deltaAt,
  duration,
  durationBetween,
  durationToSeconds,
  formatIso,
  InvalidTimeError,
  instantFromDate,
  instantFromTaiNanos,
  instantFromUnixMillis,
  instantFromUnixNanos,
  instantFromUnixSeconds,
  instantNow,
  instantsEqual,
  instantToDate,
  instantToUnixMillis,
  instantToUnixNanos,
  instantToUtc,
  type LeapSecondTable,
  parseInstant,
  subtractDuration,
  taiNanosOf,
  unwrap,
  utcToInstant,
} from '../src/index.js'

const iso = (text: string) => unwrap(parseInstant(text))

describe('UTC ↔ instant', () => {
  it('maps the Unix epoch to TAI 1970-01-01T00:00:10 (pre-1972 ΔAT = 10)', () => {
    const epoch = unwrap(utcToInstant({ year: 1970, month: 1, day: 1 }))
    expect(taiNanosOf(epoch)).toBe(10_000_000_000n)
  })

  it('applies TAI − UTC = 37 s after 2017', () => {
    expect(deltaAt(iso('2026-08-19T00:00:00Z'))).toBe(37)
    expect(formatIso(iso('2026-08-19T00:00:00Z'), { scale: 'tai' })).toBe('2026-08-19T00:00:37.000')
  })

  it('accepts 23:59:60 only at a real leap second', () => {
    expect(
      utcToInstant({ year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 }).ok,
    ).toBe(true)
    const bad = utcToInstant({ year: 2016, month: 12, day: 30, hour: 23, minute: 59, second: 60 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toBeInstanceOf(InvalidTimeError)
      expect(bad.error.field).toBe('second')
      expect(bad.error.reason).toBe('no leap second is inserted at this time')
    }
    const midday = utcToInstant({ year: 2016, month: 12, day: 31, hour: 12, minute: 0, second: 60 })
    expect(midday.ok).toBe(false)
    if (!midday.ok) expect(midday.error.reason).toBe('a leap second can only occur at 23:59:60')
  })

  it('rejects a second deleted by a negative leap second', () => {
    const table: LeapSecondTable = {
      entries: [
        { unixSeconds: 63_072_000, deltaAt: 10 },
        { unixSeconds: 1_893_456_000, deltaAt: 9 }, // hypothetical 2030-01-01 negative leap
      ],
      expires: null,
    }
    const deleted = utcToInstant(
      { year: 2029, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
      { leapSeconds: table },
    )
    expect(deleted.ok).toBe(false)
    if (!deleted.ok)
      expect(deleted.error.reason).toBe('this second is deleted by a negative leap second')
    const before = unwrap(
      utcToInstant(
        { year: 2029, month: 12, day: 31, hour: 23, minute: 59, second: 58 },
        { leapSeconds: table },
      ),
    )
    const after = unwrap(utcToInstant({ year: 2030, month: 1, day: 1 }, { leapSeconds: table }))
    expect(durationToSeconds(durationBetween(before, after))).toBe(1)
    expect(instantToUtc(after, { leapSeconds: table })).toStrictEqual({
      year: 2030,
      month: 1,
      day: 1,
      dayOfYear: 1,
      hour: 0,
      minute: 0,
      second: 0,
      nanosecond: 0,
    })
  })

  it('validates field ranges', () => {
    const cases: Array<[Parameters<typeof utcToInstant>[0], string, number]> = [
      [{ year: 2024, month: 13, day: 1 }, 'month', 13],
      [{ year: 2023, month: 2, day: 29 }, 'day', 29],
      [{ year: 2023, dayOfYear: 366 }, 'dayOfYear', 366],
      [{ year: 2024, month: 1, day: 1, hour: 24 }, 'hour', 24],
      [{ year: 2024, month: 1, day: 1, minute: 60 }, 'minute', 60],
      [{ year: 2024, month: 1, day: 1, second: 61 }, 'second', 61],
      [{ year: 2024, month: 1, day: 1, nanosecond: 1_000_000_000 }, 'nanosecond', 1_000_000_000],
      [{ year: 2024, month: 1.5, day: 1 }, 'month', 1.5],
    ]
    for (const [fields, field, value] of cases) {
      const result = utcToInstant(fields)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.field).toBe(field)
        expect(result.error.value).toBe(value)
      }
    }
  })

  it('accepts ordinal dates and reports dayOfYear', () => {
    const fromOrdinal = unwrap(utcToInstant({ year: 2024, dayOfYear: 366, hour: 6 }))
    expect(instantsEqual(fromOrdinal, iso('2024-12-31T06:00:00Z'))).toBe(true)
    expect(instantToUtc(fromOrdinal).dayOfYear).toBe(366)
  })

  it('round-trips a leap second through instantToUtc', () => {
    expect(instantToUtc(iso('2015-06-30T23:59:60.123456789Z'))).toStrictEqual({
      year: 2015,
      month: 6,
      day: 30,
      dayOfYear: 181,
      hour: 23,
      minute: 59,
      second: 60,
      nanosecond: 123_456_789,
    })
  })
})

describe('Unix / Date interop', () => {
  it('round-trips milliseconds and keeps sub-millisecond precision', () => {
    const i = instantFromUnixMillis(1_755_606_896_789.25)
    expect(instantToUnixMillis(i)).toBe(1_755_606_896_789.25)
    expect(instantToUnixNanos(i)).toBe(1_755_606_896_789_250_000n)
  })

  it('handles negative Unix times', () => {
    const i = instantFromUnixSeconds(-1.5)
    expect(formatIso(i)).toBe('1969-12-31T23:59:58.500Z')
    expect(instantToUnixMillis(i)).toBe(-1500)
  })

  it('follows POSIX inside a leap second (values repeat)', () => {
    const leap = iso('2016-12-31T23:59:60.500Z')
    const after = iso('2017-01-01T00:00:00.500Z')
    expect(instantToUnixMillis(leap)).toBe(1_483_228_800_500)
    expect(instantToUnixMillis(after)).toBe(1_483_228_800_500)
    expect(durationToSeconds(durationBetween(leap, after))).toBe(1)
  })

  it('converts to and from Date', () => {
    const date = new Date('2026-08-19T12:34:56.789Z')
    const i = instantFromDate(date)
    expect(instantToDate(i)).toStrictEqual(date)
    expect(() => instantFromDate(new Date(Number.NaN))).toThrow(RangeError)
  })

  it('instantNow uses the injected clock', () => {
    const i = instantNow({ now: () => 1_483_228_800_000 })
    expect(formatIso(i)).toBe('2017-01-01T00:00:00.000Z')
  })

  it('rejects non-finite inputs', () => {
    expect(() => instantFromUnixSeconds(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('instantFromUnixNanos picks the post-leap mapping at a boundary', () => {
    const i = instantFromUnixNanos(1_483_228_800_000_000_000n)
    expect(formatIso(i, { scale: 'tai' })).toBe('2017-01-01T00:00:37.000')
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exact durations across a leap second', () => {
    const start = iso('2016-12-31T23:59:59Z')
    const plusTwo = addDuration(start, duration({ seconds: 2 }))
    expect(formatIso(plusTwo)).toBe('2017-01-01T00:00:00.000Z')
    expect(instantsEqual(subtractDuration(plusTwo, duration({ seconds: 2 })), start)).toBe(true)
  })

  it('compares instants', () => {
    const a = instantFromTaiNanos(1n)
    const b = instantFromTaiNanos(2n)
    expect(compareInstants(a, b)).toBe(-1)
    expect(compareInstants(b, a)).toBe(1)
    expect(compareInstants(a, instantFromTaiNanos(1n))).toBe(0)
  })
})
