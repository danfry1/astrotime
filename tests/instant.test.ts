import { describe, expect, it } from 'vitest'

import {
  addDuration,
  clampInstant,
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
  instantFromUtc,
  instantNow,
  instantRange,
  instantsEqual,
  instantToDate,
  instantToTaiNanos,
  instantToUnixMillis,
  instantToUnixNanos,
  instantToUnixSeconds,
  instantToUtc,
  IERS_LEAP_SECONDS,
  isAfter,
  isBefore,
  isInstant,
  isLeapSecond,
  isLeapSecondTableExpired,
  isUtcDefined,
  type LeapSecondTable,
  maxInstant,
  minInstant,
  parseInstantOrThrow,
  subtractDuration,
  UNIX_EPOCH_INSTANT,
  UTC_START_INSTANT,
} from '../src/index.js'
import { expectErr } from './helpers.js'

const iso = parseInstantOrThrow

describe('UTC ↔ instant', () => {
  it('maps the Unix epoch to TAI 1970-01-01T00:00:10 (pre-1972 ΔAT = 10)', () => {
    expect(instantToTaiNanos(UNIX_EPOCH_INSTANT)).toBe(10_000_000_000n)
    expect(instantsEqual(iso('1970-01-01T00:00:00Z'), UNIX_EPOCH_INSTANT)).toBe(true)
    expect(formatIso(UTC_START_INSTANT)).toBe('1972-01-01T00:00:00.000Z')
  })

  it('applies TAI − UTC = 37 s after 2017', () => {
    expect(deltaAt(iso('2026-08-19T00:00:00Z'))).toBe(37)
    expect(formatIso(iso('2026-08-19T00:00:00Z'), { scale: 'tai' })).toBe(
      '2026-08-19T00:00:37.000 TAI',
    )
  })

  it('accepts 23:59:60 only at a real leap second', () => {
    expect(
      instantFromUtc({ year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 }).ok,
    ).toBe(true)
    const bad = expectErr(
      instantFromUtc({ year: 2016, month: 12, day: 30, hour: 23, minute: 59, second: 60 }),
    )
    expect(bad).toBeInstanceOf(InvalidTimeError)
    expect(bad.toJSON()).toStrictEqual({
      name: 'InvalidTimeError',
      code: 'INVALID_TIME',
      message: 'Invalid second 60: no leap second is inserted at this time',
      field: 'second',
      value: 60,
      reason: 'no leap second is inserted at this time',
    })
    const midday = expectErr(
      instantFromUtc({ year: 2016, month: 12, day: 31, hour: 12, minute: 0, second: 60 }),
    )
    expect(midday.reason).toBe('a leap second can only occur at 23:59:60')
  })

  it('rejects a second deleted by a negative leap second', () => {
    const table: LeapSecondTable = {
      entries: [
        ...IERS_LEAP_SECONDS.entries,
        { unixSeconds: 1_893_456_000, deltaAt: 36 }, // hypothetical 2030-01-01 negative leap
      ],
      expires: null,
    }
    const deleted = expectErr(
      instantFromUtc(
        { year: 2029, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
        { leapSeconds: table },
      ),
    )
    expect(deleted.reason).toBe('this second is deleted by a negative leap second')
    const before = parseInstantOrThrow('2029-12-31T23:59:58Z', { leapSeconds: table })
    const after = parseInstantOrThrow('2030-01-01T00:00:00Z', { leapSeconds: table })
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

  it.each([
    [{ year: 2024, month: 13, day: 1 }, 'month', 13, 'must be between 1 and 12'],
    [{ year: 2023, month: 2, day: 29 }, 'day', 29, 'must be between 1 and 28'],
    [{ year: 2023, dayOfYear: 366 }, 'dayOfYear', 366, 'must be between 1 and 365'],
    [
      { year: 2024, month: 12, day: 31, dayOfYear: 365 },
      'dayOfYear',
      365,
      'must agree with month/day (expected 366)',
    ],
    [{ year: 2024, month: 1, day: 1, hour: 24 }, 'hour', 24, 'must be between 0 and 23'],
    [{ year: 2024, month: 1, day: 1, minute: 60 }, 'minute', 60, 'must be between 0 and 59'],
    [{ year: 2024, month: 1, day: 1, second: 61 }, 'second', 61, 'must be between 0 and 60'],
    [
      { year: 2024, month: 1, day: 1, nanosecond: 1_000_000_000 },
      'nanosecond',
      1_000_000_000,
      'must be between 0 and 999999999',
    ],
    [{ year: 2024, month: 1.5, day: 1 }, 'month', 1.5, 'must be an integer'],
    [
      { year: 1_000_000, month: 1, day: 1 },
      'year',
      1_000_000,
      'must be between -999999 and 999999',
    ],
  ] as const)('rejects %j', (fields, field, value, reason) => {
    const error = expectErr(instantFromUtc(fields))
    expect([error.field, error.value, error.reason]).toStrictEqual([field, value, reason])
  })

  it('accepts ordinal dates and reports dayOfYear', () => {
    const fromOrdinal = instantFromUtc({ year: 2024, dayOfYear: 366, hour: 6 })
    expect(fromOrdinal.ok && instantsEqual(fromOrdinal.value, iso('2024-12-31T06:00:00Z'))).toBe(
      true,
    )
    expect(fromOrdinal.ok && instantToUtc(fromOrdinal.value).dayOfYear).toBe(366)
  })

  it('accepts a dayOfYear that agrees with month/day (CivilDateTime round-trips)', () => {
    const roundTripped = instantFromUtc(instantToUtc(iso('2024-12-31T06:00:00Z')))
    expect(roundTripped.ok && instantsEqual(roundTripped.value, iso('2024-12-31T06:00:00Z'))).toBe(
      true,
    )
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

  it('identifies leap seconds', () => {
    expect(isLeapSecond(iso('2016-12-31T23:59:60Z'))).toBe(true)
    expect(isLeapSecond(iso('2016-12-31T23:59:60.999999999Z'))).toBe(true)
    expect(isLeapSecond(iso('2016-12-31T23:59:59.999999999Z'))).toBe(false)
    expect(isLeapSecond(iso('2017-01-01T00:00:00Z'))).toBe(false)
  })

  it('validates hand-built tables once and rejects malformed ones', () => {
    const broken: LeapSecondTable = {
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1, deltaAt: 38 }],
      expires: null,
    }
    expect(() => instantToUtc(UNIX_EPOCH_INSTANT, { leapSeconds: broken })).toThrow(
      new RangeError('Invalid leap-second table: entries must start at a UTC midnight'),
    )
    const jump: LeapSecondTable = {
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_893_456_000, deltaAt: 39 }],
      expires: null,
    }
    expect(() => deltaAt(UNIX_EPOCH_INSTANT, { leapSeconds: jump })).toThrow(RangeError)
  })
})

describe('before 1972', () => {
  it('approximates by default and can be told to reject', () => {
    const i = iso('1965-01-01T00:00:00Z')
    expect(isUtcDefined(i)).toBe(false)
    expect(isUtcDefined(UTC_START_INSTANT)).toBe(true)
    expect(deltaAt(i)).toBe(10)
    expect(
      expectErr(
        instantFromUtc({ year: 1971, month: 12, day: 31 }, { before1972: 'reject' }),
      ).toJSON(),
    ).toStrictEqual({
      name: 'InvalidTimeError',
      code: 'INVALID_TIME',
      message: 'Invalid year 1971: UTC is undefined before 1972-01-01',
      field: 'year',
      value: 1971,
      reason: 'UTC is undefined before 1972-01-01',
    })
    expect(instantFromUtc({ year: 1972, month: 1, day: 1 }, { before1972: 'reject' }).ok).toBe(true)
    expect(() => instantToUtc(i, { before1972: 'reject' })).toThrow(InvalidTimeError)
    expect(() => instantToUnixNanos(i, { before1972: 'reject' })).toThrow(InvalidTimeError)
    expect(() => instantFromUnixNanos(0n, { before1972: 'reject' })).toThrow(InvalidTimeError)
    expect(instantToUtc(UTC_START_INSTANT, { before1972: 'reject' }).year).toBe(1972)
  })
})

describe('Unix / Date interop', () => {
  it('round-trips milliseconds and keeps sub-millisecond precision', () => {
    const i = instantFromUnixMillis(1_755_606_896_789.25)
    expect(instantToUnixMillis(i)).toBe(1_755_606_896_789.25)
    expect(instantToUnixNanos(i)).toBe(1_755_606_896_789_250_000n)
  })

  it('handles negative and tiny Unix times without cancellation error', () => {
    const i = instantFromUnixSeconds(-1.5)
    expect(formatIso(i)).toBe('1969-12-31T23:59:58.500Z')
    expect(instantToUnixMillis(i)).toBe(-1500)
    expect(instantToUnixMillis(instantFromTaiNanos(9_999_999_999n))).toBe(-0.000001)
    expect(instantToUnixSeconds(instantFromTaiNanos(9_999_999_999n))).toBe(-1e-9)
  })

  it('follows POSIX inside a leap second (values repeat)', () => {
    const leap = iso('2016-12-31T23:59:60.500Z')
    const after = iso('2017-01-01T00:00:00.500Z')
    expect(instantToUnixMillis(leap)).toBe(1_483_228_800_500)
    expect(instantToUnixMillis(after)).toBe(1_483_228_800_500)
    expect(durationToSeconds(durationBetween(leap, after))).toBe(1)
    expect(instantToDate(leap).toISOString()).toBe('2017-01-01T00:00:00.500Z')
  })

  it('converts to and from Date', () => {
    const date = new Date('2026-08-19T12:34:56.789Z')
    expect(instantToDate(instantFromDate(date))).toStrictEqual(date)
    expect(instantToDate(instantFromUnixMillis(-0.5)).getTime()).toBe(-1)
    expect(() => instantFromDate(new Date(Number.NaN))).toThrow(
      new RangeError('Cannot convert an invalid Date to an Instant'),
    )
  })

  it('instantNow uses the injected clock', () => {
    expect(formatIso(instantNow({ now: () => 1_483_228_800_000 }))).toBe('2017-01-01T00:00:00.000Z')
    expect(isInstant(instantNow())).toBe(true)
  })

  it('rejects non-finite inputs with a RangeError', () => {
    expect(() => instantFromUnixSeconds(Number.POSITIVE_INFINITY)).toThrow(
      new RangeError('Unix seconds must be a finite number, got Infinity'),
    )
    expect(() => instantFromUnixMillis(Number.NaN)).toThrow(RangeError)
  })

  it('instantFromUnixNanos picks the post-leap mapping at a boundary', () => {
    expect(formatIso(instantFromUnixNanos(1_483_228_800_000_000_000n), { scale: 'tai' })).toBe(
      '2017-01-01T00:00:37.000 TAI',
    )
  })
})

describe('values', () => {
  it('are frozen, branded and serialisable', () => {
    const i = iso('2026-08-19T12:34:56.789012345Z')
    expect(Object.isFrozen(i)).toBe(true)
    expect(isInstant(i)).toBe(true)
    expect(isInstant({ taiNanos: 0n })).toBe(false)
    // Serialization is TAI (table-independent): correct under any leap table.
    expect(JSON.stringify({ at: i })).toBe('{"at":"2026-08-19T12:35:33.789012345 TAI"}')
    expect(String(iso('-0044-03-15T00:00:00Z'))).toBe('-0044-03-15T00:00:10.000000000 TAI')
    expect(instantsEqual(parseInstantOrThrow(String(i)), i)).toBe(true)
  })
})

describe('arithmetic and ordering', () => {
  it('adds and subtracts exact durations across a leap second', () => {
    const start = iso('2016-12-31T23:59:59Z')
    const plusTwo = addDuration(start, duration({ seconds: 2 }))
    expect(formatIso(plusTwo)).toBe('2017-01-01T00:00:00.000Z')
    expect(instantsEqual(subtractDuration(plusTwo, duration({ seconds: 2 })), start)).toBe(true)
  })

  it('compares, orders and clamps', () => {
    const a = instantFromTaiNanos(1n)
    const b = instantFromTaiNanos(2n)
    const c = instantFromTaiNanos(3n)
    expect(compareInstants(a, b)).toBe(-1)
    expect(compareInstants(b, a)).toBe(1)
    expect(compareInstants(a, instantFromTaiNanos(1n))).toBe(0)
    expect(isBefore(a, b)).toBe(true)
    expect(isAfter(a, b)).toBe(false)
    expect(minInstant(b, a)).toBe(a)
    expect(maxInstant(a, b)).toBe(b)
    expect(clampInstant(c, a, b)).toBe(b)
    expect(clampInstant(instantFromTaiNanos(0n), a, b)).toBe(a)
    expect(clampInstant(b, a, c)).toBe(b)
  })

  it('generates ranges', () => {
    const start = iso('2026-08-19T00:00:00Z')
    const end = iso('2026-08-19T00:00:03Z')
    const step = duration({ seconds: 1 })
    expect(
      [...instantRange(start, end, step)].map((i) => formatIso(i, { precision: 'seconds' })),
    ).toStrictEqual(['2026-08-19T00:00:00Z', '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z'])
    expect([...instantRange(start, end, step, { inclusive: true })]).toHaveLength(4)
    expect(
      [...instantRange(end, start, duration({ seconds: -2 }))].map((i) =>
        formatIso(i, { precision: 'seconds' }),
      ),
    ).toStrictEqual(['2026-08-19T00:00:03Z', '2026-08-19T00:00:01Z'])
    expect([...instantRange(end, start, step)]).toStrictEqual([])
    expect(() => [...instantRange(start, end, duration({}))]).toThrow(
      new RangeError('instantRange step must be non-zero'),
    )
  })

  it('checks table expiry against an instant or Unix seconds', () => {
    expect(isLeapSecondTableExpired(IERS_LEAP_SECONDS, iso('2027-06-27T23:59:59Z'))).toBe(false)
    expect(isLeapSecondTableExpired(IERS_LEAP_SECONDS, iso('2027-06-28T00:00:00Z'))).toBe(true)
    expect(isLeapSecondTableExpired(IERS_LEAP_SECONDS, 1_814_140_799)).toBe(false)
    expect(
      isLeapSecondTableExpired({ entries: IERS_LEAP_SECONDS.entries, expires: null }, 1e12),
    ).toBe(false)
    expect(() => isLeapSecondTableExpired({ entries: [], expires: null }, 1e12)).toThrow(RangeError)
    expect(() => isLeapSecondTableExpired(IERS_LEAP_SECONDS, Number.NaN)).toThrow(RangeError)
  })

  it('rejects inverted clamp bounds instead of returning an out-of-range instant', () => {
    const lo = instantFromTaiNanos(2n)
    const hi = instantFromTaiNanos(1n)
    expect(() => clampInstant(instantFromTaiNanos(0n), lo, hi)).toThrow(RangeError)
  })
})
