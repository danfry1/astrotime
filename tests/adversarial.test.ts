import { describe, expect, it } from 'vitest'

import {
  addDuration,
  duration,
  durationBetween,
  durationToSeconds,
  formatIso,
  IERS_LEAP_SECONDS,
  InvalidTimeError,
  instantFromTaiNanos,
  instantFromUnixNanos,
  instantFromUtc,
  instantRange,
  instantsEqual,
  instantToDate,
  instantToJulianDateParts,
  instantToModifiedJulianDate,
  instantToTaiNanos,
  instantToUnixNanos,
  instantToUnixSeconds,
  instantToUtc,
  isLeapSecondTableExpired,
  type LeapSecondTable,
  parseInstant,
  parseInstantOrThrow,
  parseLeapSecondsList,
  truncateInstant,
  unwrap,
  validateLeapSecondTable,
} from '../src/index.js'
import { expectErr } from './helpers.js'

/** Bundled table plus a hypothetical positive leap at 2028-01-01. */
const TABLE_2028: LeapSecondTable = unwrap(
  validateLeapSecondTable({
    entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_830_297_600, deltaAt: 38 }],
    expires: null,
  }),
)

/** Table with a hypothetical negative leap (23:59:59 deleted) at 2030-01-01. */
const NEGATIVE_2030: LeapSecondTable = unwrap(
  validateLeapSecondTable({
    entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_893_456_000, deltaAt: 36 }],
    expires: null,
  }),
)

describe('serialization is leap-table independent', () => {
  it('JSON round-trips identically under bundled and custom tables', () => {
    const i = parseInstantOrThrow('2028-01-01T00:00:00Z', { leapSeconds: TABLE_2028 })
    const revived = parseInstantOrThrow(JSON.parse(JSON.stringify(i)) as string)
    expect(instantsEqual(revived, i)).toBe(true)
    // The TAI string never depends on which table produced the instant.
    expect(JSON.stringify(i)).toBe(JSON.stringify(instantFromTaiNanos(instantToTaiNanos(i))))
  })

  it('serializes instants inside inserted leap seconds losslessly', () => {
    const leap = parseInstantOrThrow('2016-12-31T23:59:60.123456789Z')
    expect(String(leap)).toBe('2017-01-01T00:00:36.123456789 TAI')
    expect(instantsEqual(parseInstantOrThrow(String(leap)), leap)).toBe(true)
  })

  it('toJSON throws rather than emitting a year that cannot round-trip', () => {
    expect(() => JSON.stringify(instantFromTaiNanos(10n ** 24n))).toThrow(RangeError)
    expect(() => formatIso(instantFromTaiNanos(10n ** 24n))).toThrow(RangeError)
  })
})

describe('leap-table integrity', () => {
  it('validateLeapSecondTable returns a deeply frozen copy', () => {
    const table = unwrap(
      validateLeapSecondTable({
        entries: [{ unixSeconds: 63_072_000, deltaAt: 10 }],
        expires: null,
      }),
    )
    expect(Object.isFrozen(table)).toBe(true)
    expect(Object.isFrozen(table.entries)).toBe(true)
    expect(Object.isFrozen(table.entries[0])).toBe(true)
  })

  it('parseLeapSecondsList output and the bundled table are frozen', () => {
    const parsed = unwrap(parseLeapSecondsList('2272060800 10\n2287785600 11\n'))
    expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.entries)).toBe(true)
    expect(Object.isFrozen(IERS_LEAP_SECONDS) && Object.isFrozen(IERS_LEAP_SECONDS.entries)).toBe(
      true,
    )
    const entries: unknown = IERS_LEAP_SECONDS.entries
    expect(() => {
      ;(entries as unknown[]).push(null)
    }).toThrow(TypeError)
  })

  it('mutating an unfrozen table after warming caches cannot poison results', () => {
    const entries = IERS_LEAP_SECONDS.entries.map((e) => ({ ...e }))
    const mutable: LeapSecondTable = { entries, expires: null }
    // Warm every cache with the pre-mutation table.
    const before = instantToUtc(
      parseInstantOrThrow('2027-12-31T23:59:59Z', { leapSeconds: mutable }),
      {
        leapSeconds: mutable,
      },
    )
    expect(before.second).toBe(59)
    // Mutate: add a 2028 leap second.
    entries.push({ unixSeconds: 1_830_297_600, deltaAt: 38 })
    // Unfrozen tables are revalidated and never cached, so the new entry is honoured...
    const leap = instantFromUtc(
      { year: 2027, month: 12, day: 31, hour: 23, minute: 59, second: 60 },
      { leapSeconds: mutable },
    )
    expect(leap.ok).toBe(true)
    // ...and the post-leap mapping matches a freshly built frozen table.
    const fresh = parseInstantOrThrow('2028-01-01T00:00:00Z', { leapSeconds: TABLE_2028 })
    expect(
      instantsEqual(parseInstantOrThrow('2028-01-01T00:00:00Z', { leapSeconds: mutable }), fresh),
    ).toBe(true)
  })

  it.each([
    [{ entries: [], expires: null }, 'table has no entries'],
    [
      { entries: [{ unixSeconds: 63_072_000.5, deltaAt: 10 }], expires: null },
      'entries must be safe integers',
    ],
    [
      { entries: [{ unixSeconds: 63_072_000, deltaAt: 10 }], expires: 1.5 },
      'expires must be a safe integer or null',
    ],
    [
      { entries: [{ unixSeconds: 63_072_000, deltaAt: 10 }], expires: null, updated: Number.NaN },
      'updated must be a safe integer, null, or absent',
    ],
  ] as const)('rejects malformed table %#', (table, reason) => {
    expect(expectErr(validateLeapSecondTable(table)).reason).toBe(reason)
    expect(() => instantToUtc(instantFromTaiNanos(0n), { leapSeconds: table })).toThrow(RangeError)
  })

  it('rejects oversized leap-second lists', () => {
    const bomb = '2272060800 10\n'.repeat(10_001)
    expect(expectErr(parseLeapSecondsList(bomb)).reason).toBe('list exceeds 10000 lines')
  })
})

describe('stale-table policy', () => {
  const past = parseInstantOrThrow('2026-01-01T00:00:00Z')
  const beyondExpiry = { year: 2028, month: 1, day: 1 }

  it('fails open by default (documented) and can be told to reject', () => {
    expect(instantFromUtc(beyondExpiry).ok).toBe(true)
    const rejected = expectErr(instantFromUtc(beyondExpiry, { tableValidity: 'reject' }))
    expect(rejected).toBeInstanceOf(InvalidTimeError)
    expect(rejected.reason).toBe(
      'epoch is past the leap-second table expiry (future leap seconds are unknown)',
    )
  })

  it('enforces the policy on every conversion path', () => {
    const future = parseInstantOrThrow('2028-01-01T00:00:00Z')
    expect(() => instantToUtc(future, { tableValidity: 'reject' })).toThrow(InvalidTimeError)
    expect(() => instantToUnixNanos(future, { tableValidity: 'reject' })).toThrow(InvalidTimeError)
    expect(() =>
      instantFromUnixNanos(1_830_297_600_000_000_000n, { tableValidity: 'reject' }),
    ).toThrow(InvalidTimeError)
    expect(parseInstant('2028-01-01T00:00:00Z', { tableValidity: 'reject' }).ok).toBe(false)
    // Within validity nothing changes.
    expect(() => instantToUtc(past, { tableValidity: 'reject' })).not.toThrow()
    // A table without an expiry never rejects.
    expect(
      instantFromUtc(beyondExpiry, { tableValidity: 'reject', leapSeconds: TABLE_2028 }).ok,
    ).toBe(true)
  })

  it('isLeapSecondTableExpired agrees with the policy boundary', () => {
    expect(
      isLeapSecondTableExpired(IERS_LEAP_SECONDS, parseInstantOrThrow('2027-06-27T23:59:59Z')),
    ).toBe(false)
    expect(
      isLeapSecondTableExpired(IERS_LEAP_SECONDS, parseInstantOrThrow('2027-06-28T00:00:00Z')),
    ).toBe(true)
  })
})

describe('negative leap second across every API', () => {
  const lastSecond = parseInstantOrThrow('2029-12-31T23:59:58Z', { leapSeconds: NEGATIVE_2030 })
  const midnight = parseInstantOrThrow('2030-01-01T00:00:00Z', { leapSeconds: NEGATIVE_2030 })

  it('elapsed time across the boundary is one second (58 to 00)', () => {
    expect(durationToSeconds(durationBetween(lastSecond, midnight))).toBe(1)
    expect(
      formatIso(addDuration(lastSecond, duration({ seconds: 1 })), { leapSeconds: NEGATIVE_2030 }),
    ).toBe('2030-01-01T00:00:00.000Z')
  })

  it('Unix time skips the deleted second without repeating', () => {
    expect(instantToUnixSeconds(lastSecond, { leapSeconds: NEGATIVE_2030 })).toBe(1_893_455_998)
    expect(instantToUnixSeconds(midnight, { leapSeconds: NEGATIVE_2030 })).toBe(1_893_456_000)
    const roundTrip = instantFromUnixNanos(
      instantToUnixNanos(midnight, { leapSeconds: NEGATIVE_2030 }),
      {
        leapSeconds: NEGATIVE_2030,
      },
    )
    expect(instantsEqual(roundTrip, midnight)).toBe(true)
  })

  it('UTC quasi-JD treats the shortened day as 86399 seconds and stays monotonic', () => {
    const opts = { leapSeconds: NEGATIVE_2030 }
    const mjdBefore = instantToModifiedJulianDate(lastSecond, 'utc', opts)
    const mjdMidnight = instantToModifiedJulianDate(midnight, 'utc', opts)
    expect(mjdBefore < mjdMidnight).toBe(true)
    expect(mjdMidnight).toBe(62_502)
    const parts = instantToJulianDateParts(lastSecond, 'utc', opts)
    expect(parts.jd2 * 86_399).toBeCloseTo(86_398, 6)
  })

  it('truncation lands on real boundaries around the deleted second', () => {
    const opts = { leapSeconds: NEGATIVE_2030 }
    expect(formatIso(truncateInstant(midnight, 'day', 'utc', opts), opts)).toBe(
      '2030-01-01T00:00:00.000Z',
    )
    expect(formatIso(truncateInstant(lastSecond, 'minute', 'utc', opts), opts)).toBe(
      '2029-12-31T23:59:00.000Z',
    )
  })

  it('instantRange steps straight across the gap', () => {
    const steps = [
      ...instantRange(lastSecond, midnight, duration({ seconds: 1 }), { inclusive: true }),
    ].map((i) => formatIso(i, { leapSeconds: NEGATIVE_2030, precision: 'seconds' }))
    expect(steps).toStrictEqual(['2029-12-31T23:59:58Z', '2030-01-01T00:00:00Z'])
  })
})

describe('input hardening', () => {
  it('expanded years round-trip through ISO and token patterns in both signs', () => {
    for (const text of ['+010000-01-01T00:00:00Z', '-010000-01-01T00:00:00Z']) {
      const i = parseInstantOrThrow(text)
      expect(formatIso(i, { precision: 'nanos' })).toBe(`${text.slice(0, -1)}.000000000Z`)
      const viaToken = parseInstantOrThrow(`${text.slice(0, 7)}-001`, { format: 'YYYY-DDD' })
      expect(instantToUtc(viaToken).dayOfYear).toBe(1)
    }
  })

  it('rejects values outside representable ranges instead of corrupting them', () => {
    expect(() => instantToDate(instantFromTaiNanos(10n ** 22n))).toThrow(RangeError)
    const bad = instantFromUtc({ year: Number.NaN, month: 1, day: 1 })
    expect(expectErr(bad).reason).toBe('must be an integer')
  })

  it('survives pathological parser input without throwing', () => {
    const nasty = [
      '9'.repeat(100_000),
      `${'['.repeat(10_000)}]`,
      `P${'9'.repeat(64)}D`,
      ' '.repeat(1000),
    ]
    for (const text of nasty) {
      expect(parseInstant(text).ok).toBe(false)
      expect(parseInstant(text, { format: 'YYYY-MM-DD' }).ok).toBe(false)
    }
  })
})
