import { describe, expect, it } from 'vitest'

import {
  addToInstant,
  deltaAtUnixSeconds,
  duration,
  durationToNanos,
  formatDuration,
  formatPatternError,
  parseDurationOrThrow,
  durationBetween,
  durationToSeconds,
  formatIso,
  parseInstant,
  parsePatternError,
  formatInstant,
  IERS_LEAP_SECONDS,
  InvalidTimeError,
  instantFromTaiNanos,
  instantFromOffsetMillis,
  instantFromOffsetSeconds,
  instantFromJulianDateParts,
  instantFromUnixMillis,
  instantFromUnixNanos,
  instantFromUtc,
  instantRange,
  instantsEqual,
  instantToDate,
  instantToJulianDateParts,
  instantToModifiedJulianDate,
  instantToOffsetMillis,
  instantToOffsetSeconds,
  instantToScaleSeconds,
  instantToScaleNanos,
  instantToUnixMillis,
  instantToTaiNanos,
  instantToUnixNanos,
  instantToUnixSeconds,
  instantToUtc,
  isLeapSecondTableExpired,
  type LeapSecondTable,
  parseInstantOrThrow,
  parseLeapSecondsList,
  truncateInstant,
  unixMillisResolutionNanos,
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
        entries: IERS_LEAP_SECONDS.entries.map((e) => ({ ...e })),
        expires: null,
      }),
    )
    expect(Object.isFrozen(table)).toBe(true)
    expect(Object.isFrozen(table.entries)).toBe(true)
    expect(Object.isFrozen(table.entries[0])).toBe(true)
  })

  it('parseLeapSecondsList output and the bundled table are frozen', () => {
    const fullText = IERS_LEAP_SECONDS.entries
      .map((e) => `${String(e.unixSeconds + 2_208_988_800)} ${String(e.deltaAt)}`)
      .join('\n')
    const parsed = unwrap(parseLeapSecondsList(`${fullText}\n`))
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

  it('returns or throws deliberate table errors for malformed runtime shapes', () => {
    for (const [table, reason] of [
      [null, 'table must be an object'],
      [{}, 'entries must be an array'],
      [{ entries: [null], expires: null }, 'entries must be objects'],
    ] as const) {
      expect(expectErr(validateLeapSecondTable(table as never)).reason).toContain(reason)
      expect(() => instantToUtc(instantFromTaiNanos(0n), { leapSeconds: table as never })).toThrow(
        RangeError,
      )
    }
  })

  it('rejects oversized leap-second lists', () => {
    const bomb = '2272060800 10\n'.repeat(10_001)
    expect(expectErr(parseLeapSecondsList(bomb)).reason).toBe('list exceeds 10000 lines')
  })

  it('rejects contradictory leap-table metadata', () => {
    expect(
      expectErr(
        validateLeapSecondTable({
          entries: IERS_LEAP_SECONDS.entries,
          expires: IERS_LEAP_SECONDS.entries.at(-1)?.unixSeconds ?? 0,
        }),
      ).reason,
    ).toBe('expires must be later than the final leap-second entry')
    expect(
      expectErr(
        validateLeapSecondTable({
          entries: IERS_LEAP_SECONDS.entries,
          expires: 1_800_000_000,
          updated: 1_800_000_001,
        }),
      ).reason,
    ).toBe('updated must not be later than expires')
  })

  it('accepts every non-contradictory update/expiry metadata state', () => {
    const entries = IERS_LEAP_SECONDS.entries
    expect(
      validateLeapSecondTable({ entries, expires: 1_800_000_000, updated: 1_800_000_000 }).ok,
    ).toBe(true)
    expect(validateLeapSecondTable({ entries, expires: null, updated: 1_800_000_000 }).ok).toBe(
      true,
    )
    expect(validateLeapSecondTable({ entries, expires: null, updated: null }).ok).toBe(true)
    expect(validateLeapSecondTable({ entries, expires: null }).ok).toBe(true)
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
      formatIso(addToInstant(lastSecond, duration({ seconds: 1 })), { leapSeconds: NEGATIVE_2030 }),
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

    const finalNanosecond = instantFromTaiNanos(instantToTaiNanos(midnight) - 1n)
    const finalParts = instantToJulianDateParts(finalNanosecond, 'utc', opts)
    expect(
      instantToTaiNanos(instantFromJulianDateParts(finalParts.jd1, finalParts.jd2, 'utc', opts)),
    ).toBe(instantToTaiNanos(finalNanosecond))
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

describe('review round 4 regressions', () => {
  it('rejects appended entries that contradict known history (fabricated 2018 leap)', () => {
    const fabricated = {
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_514_764_800, deltaAt: 38 }],
      expires: null,
    }
    expect(expectErr(validateLeapSecondTable(fabricated)).reason).toContain('coverage boundary')
    expect(() => instantToUtc(instantFromTaiNanos(0n), { leapSeconds: fabricated })).toThrow(
      RangeError,
    )
  })

  it('accepts appended entries at or after the bundled coverage boundary', () => {
    const atBoundary = validateLeapSecondTable({
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_814_140_800, deltaAt: 38 }],
      expires: null,
    })
    expect(atBoundary.ok).toBe(true)
    const multipleFuture = validateLeapSecondTable({
      entries: [
        ...IERS_LEAP_SECONDS.entries,
        { unixSeconds: 1_830_297_600, deltaAt: 38 }, // 2028 positive
        { unixSeconds: 1_893_456_000, deltaAt: 37 }, // 2030 negative
        { unixSeconds: 1_956_528_000, deltaAt: 38 }, // 2032 positive
      ],
      expires: null,
    })
    expect(multipleFuture.ok).toBe(true)
  })

  it('rejects impossible IERS dates instead of normalizing them', () => {
    const juneThirtyFirst =
      '    41317.0    1  1 1972       10\n    41499.0    31  6 1972       11\n'
    expect(expectErr(parseLeapSecondsList(juneThirtyFirst)).reason).toBe(
      'day/month/year columns are not a real date',
    )
    const febThirtyFirst =
      '#  File expires on 31 February 2027\n    41317.0    1  1 1972       10\n'
    expect(expectErr(parseLeapSecondsList(febThirtyFirst)).reason).toBe(
      'expiry date does not exist',
    )
  })

  it('verifies the IANA #h integrity record when present', () => {
    const NTP = 2_208_988_800
    const body = IERS_LEAP_SECONDS.entries
      .map((e) => `${String(e.unixSeconds + NTP)}\t${String(e.deltaAt)}`)
      .join('\n')
    const good = `#$\t3992312697\n#@\t4023129600\n#h\ta9bad145 84c31c70 758402aa b37bfd54 5923836a\n${body}\n`
    expect(parseLeapSecondsList(good).ok).toBe(true)
    // Every byte the '#h' hash covers must be tamper-evident: the '#$' stamp,
    // the '#@' expiry, and every (NTP timestamp, ΔAT) row. A replacement that
    // matches nothing would pass silently, so each tamper is asserted to have
    // changed the text before it is parsed.
    const expectTamperDetected = (from: string, to: string) => {
      const tampered = good.replace(from, to)
      expect(tampered).not.toBe(good)
      expect(expectErr(parseLeapSecondsList(tampered)).reason).toBe(
        'integrity hash (#h) does not match the file contents',
      )
    }
    expectTamperDetected('#$\t3992312697', '#$\t3992312698')
    expectTamperDetected('#@\t4023129600', '#@\t4023216000')
    for (const entry of IERS_LEAP_SECONDS.entries) {
      const ntp = String(entry.unixSeconds + NTP)
      expectTamperDetected(
        `${ntp}\t${String(entry.deltaAt)}`,
        `${ntp}\t${String(entry.deltaAt + 1)}`,
      )
    }
    const malformed = good.replace('a9bad145', 'zzzz')
    expect(expectErr(parseLeapSecondsList(malformed)).reason).toBe('malformed #h integrity record')
    for (const badWord of ['za9bad145', 'a9bad145z']) {
      expect(expectErr(parseLeapSecondsList(good.replace('a9bad145', badWord))).reason).toBe(
        'malformed #h integrity record',
      )
    }
    expect(parseLeapSecondsList(good.replace('#h\t', '#h  ')).ok).toBe(true)
  })

  it('never treats an IANA hash as verification of IERS rows it does not cover', () => {
    const iersRows = IERS_LEAP_SECONDS.entries
      .map((entry) => {
        const date = new Date(entry.unixSeconds * 1000)
        const mjd = entry.unixSeconds / 86_400 + 40_587
        return `${String(mjd)}.0 ${String(date.getUTCDate())} ${String(date.getUTCMonth() + 1)} ${String(date.getUTCFullYear())} ${String(entry.deltaAt)}`
      })
      .join('\n')
    // SHA-1 of the empty string: this used to pass because IERS rows were
    // omitted from the IANA hash input, making "verified" mean nothing.
    const emptyHash = '#h da39a3ee 5e6b4b0d 3255bfef 95601890 afd80709'
    expect(expectErr(parseLeapSecondsList(`${emptyHash}\n${iersRows}`)).reason).toBe(
      'an IANA #h integrity record requires #$, #@ and IANA data rows',
    )
  })

  it('requires both IANA timestamps before accepting an integrity record', () => {
    const rows = IERS_LEAP_SECONDS.entries
      .map((entry) => `${String(entry.unixSeconds + 2_208_988_800)} ${String(entry.deltaAt)}`)
      .join('\n')
    const hash = '#h 1 2 3 4 5'
    expect(expectErr(parseLeapSecondsList(`#@ 4023129600\n${hash}\n${rows}`)).reason).toBe(
      'an IANA #h integrity record requires #$, #@ and IANA data rows',
    )
    expect(expectErr(parseLeapSecondsList(`#$ 3992312697\n${hash}\n${rows}`)).reason).toBe(
      'an IANA #h integrity record requires #$, #@ and IANA data rows',
    )
  })

  it('rejects non-decimal metadata stamps and mixed row formats', () => {
    const ianaRows = IERS_LEAP_SECONDS.entries
      .map((entry) => `${String(entry.unixSeconds + 2_208_988_800)} ${String(entry.deltaAt)}`)
      .join('\n')
    for (const stamp of ['#$', '#$ 3.992312697e9', '#$ 0xee05f279']) {
      expect(expectErr(parseLeapSecondsList(`${stamp}\n${ianaRows}`)).reason).toBe(
        'malformed #$ update stamp',
      )
    }
    const first = IERS_LEAP_SECONDS.entries[0]
    expect(first).toBeDefined()
    const mixed = `41317.0 1 1 1972 10\n${ianaRows.split('\n').slice(1).join('\n')}`
    expect(expectErr(parseLeapSecondsList(mixed)).reason).toBe('cannot mix IANA and IERS data rows')
  })

  it('rejects ambiguous duplicate metadata and trailing row garbage', () => {
    const body = IERS_LEAP_SECONDS.entries
      .map((entry) => `${entry.unixSeconds + 2_208_988_800} ${entry.deltaAt}`)
      .join('\n')
    expect(expectErr(parseLeapSecondsList(`#@ 4023129600\n#@ 4023129600\n${body}`)).reason).toBe(
      'duplicate #@ expiry',
    )
    expect(expectErr(parseLeapSecondsList(`${body}\n#h 1 2 3 4 5\n#h 1 2 3 4 5`)).reason).toBe(
      'duplicate #h integrity record',
    )
    expect(
      expectErr(parseLeapSecondsList(body.replace('2272060800 10', '2272060800 10 garbage')))
        .reason,
    ).toContain('unrecognised line')
    expect(parseLeapSecondsList(body.replace('2272060800 10', '2272060800 10 # comment')).ok).toBe(
      true,
    )
  })
})

describe('review round 2 regressions', () => {
  it('duration serialization is closed at Number.MAX_SAFE_INTEGER days', () => {
    const d = duration({ days: Number.MAX_SAFE_INTEGER })
    const iso = formatDuration(d)
    expect(iso).toBe('P9007199254740991D')
    expect(durationToNanos(parseDurationOrThrow(iso))).toBe(durationToNanos(d))
    // Absorbed-unit clock formatting is exact (bigint, not float multiply).
    expect(formatDuration(d, 'H[h]')).toBe('216172782113783784h')
  })

  it('rejects a partial table that would silently misapply the pre-1972 fallback', () => {
    const partial = { entries: [{ unixSeconds: 1_483_228_800, deltaAt: 37 }], expires: null }
    expect(expectErr(validateLeapSecondTable(partial)).reason).toContain(
      'complete known leap-second history',
    )
    expect(() => instantToUtc(instantFromTaiNanos(0n), { leapSeconds: partial })).toThrow(
      RangeError,
    )
    expect(() => deltaAtUnixSeconds(1_451_606_400, { leapSeconds: partial })).toThrow(RangeError)
  })

  it('deltaAtUnixSeconds validates its table', () => {
    const unsorted = {
      entries: [
        { unixSeconds: 78_796_800, deltaAt: 11 },
        { unixSeconds: 63_072_000, deltaAt: 10 },
      ],
      expires: null,
    }
    expect(() => deltaAtUnixSeconds(0, { leapSeconds: unsorted })).toThrow(RangeError)
  })

  it('deleted Unix label folds forward by default and can be rejected', () => {
    const opts = { leapSeconds: NEGATIVE_2030 }
    const deletedLabel = 1_893_455_999n * 1_000_000_000n + 500_000_000n
    const folded = instantFromUnixNanos(deletedLabel, opts)
    expect(formatIso(folded, { ...opts, precision: 'auto' })).toBe('2030-01-01T00:00:00.500Z')
    expect(() => instantFromUnixNanos(deletedLabel, { ...opts, leapGap: 'reject' })).toThrow(
      new InvalidTimeError(
        'unixSeconds',
        1_893_455_999,
        'this Unix second is deleted by a negative leap second',
      ),
    )
    // Ordinary seconds are unaffected by the option.
    expect(() =>
      instantFromUnixNanos(1_893_455_998_000_000_000n, { ...opts, leapGap: 'reject' }),
    ).not.toThrow()
  })

  it('enforces non-midnight expiry stamps on civil construction', () => {
    const noonExpiry = unwrap(
      validateLeapSecondTable({ entries: [...IERS_LEAP_SECONDS.entries], expires: 1_814_183_200 }), // 2027-06-28T11:46:40Z
    )
    const opts = { leapSeconds: noonExpiry, tableValidity: 'reject' } as const
    expect(instantFromUtc({ year: 2027, month: 6, day: 28, hour: 6 }, opts).ok).toBe(true)
    expect(
      expectErr(instantFromUtc({ year: 2027, month: 6, day: 28, hour: 18 }, opts)).reason,
    ).toContain('expiry')
  })

  it('parseLeapSecondsList rejects unsafe metadata stamps and mismatched IERS rows', () => {
    expect(expectErr(parseLeapSecondsList('#@ 90071992547409934023\n2272060800 10\n')).reason).toBe(
      'malformed #@ expiry',
    )
    const badIers = '#  File expires on 28 June 2027\n    41317.0    2  1 1972       10\n'
    expect(expectErr(parseLeapSecondsList(badIers)).reason).toBe(
      'MJD does not match the day/month/year columns',
    )
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
    expect(() => instantToUtc(instantFromTaiNanos(10n ** 40n))).toThrow(RangeError)
    expect(() => instantToJulianDateParts(instantFromTaiNanos(10n ** 40n), 'tai')).toThrow(
      RangeError,
    )
    expect(() => instantToScaleSeconds(instantFromTaiNanos(10n ** 1000n), 'tai')).toThrow(
      RangeError,
    )
    const bad = instantFromUtc({ year: Number.NaN, month: 1, day: 1 })
    expect(expectErr(bad).reason).toBe('must be an integer')
    expect(JSON.stringify(expectErr(bad))).toContain('"value":"NaN"')
    expect(() => deltaAtUnixSeconds(Number.NaN)).toThrow(RangeError)
    expect(() => deltaAtUnixSeconds(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('rejects misspelled UTC safety policies instead of silently failing open', () => {
    const invalid = {
      before1972: 'rejects',
      tableValidity: 'allow',
      leapGap: 'forward',
    } as never
    expect(() => instantToUtc(parseInstantOrThrow('2026-01-01T00:00:00Z'), invalid)).toThrow(
      RangeError,
    )
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

describe('mutation-testing survivors (leap-table internals)', () => {
  it('freezeLeapSecondTable copies when any layer is mutable, and reuses fully frozen tables', () => {
    const entries = IERS_LEAP_SECONDS.entries.map((e) => ({ ...e }))
    // Outer object frozen but entries mutable: must return a distinct, deeply frozen copy.
    const outerOnly = Object.freeze({ entries, expires: null })
    const copied = unwrap(validateLeapSecondTable(outerOnly))
    expect(copied).not.toBe(outerOnly)
    expect(Object.isFrozen(copied.entries)).toBe(true)
    expect(Object.isFrozen(copied.entries[0])).toBe(true)
    // Entries array frozen but one element mutable: still copies.
    const mutableElement = IERS_LEAP_SECONDS.entries.map((e, i) => (i === 5 ? { ...e } : e))
    const elementMutable = Object.freeze({ entries: Object.freeze(mutableElement), expires: null })
    const copied2 = unwrap(validateLeapSecondTable(elementMutable))
    expect(copied2).not.toBe(elementMutable)
    // Fully frozen input is returned as-is (identity preserved for caching).
    const full = unwrap(validateLeapSecondTable({ entries, expires: null }))
    expect(unwrap(validateLeapSecondTable(full))).toBe(full)
  })

  it('deltaAtUnixSeconds boundary is inclusive at each entry start', () => {
    // Exactly at an entry's unixSeconds the new offset applies ('<=', not '<').
    expect(deltaAtUnixSeconds(1_136_073_600)).toBe(33)
    expect(deltaAtUnixSeconds(1_136_073_599)).toBe(32)
  })

  it('IERS expiry month matching is case-insensitive and prefix-based', () => {
    const rows = IERS_LEAP_SECONDS.entries
      .map((e) => {
        const date = new Date(e.unixSeconds * 1000)
        const mjd = e.unixSeconds / 86_400 + 40_587
        return `    ${String(mjd)}.0    ${String(date.getUTCDate())}  ${String(date.getUTCMonth() + 1)} ${String(date.getUTCFullYear())}       ${String(e.deltaAt)}`
      })
      .join('\n')
    const table = unwrap(parseLeapSecondsList(`#  File expires on 28 JUNE 2027\n${rows}\n`))
    expect(table.expires).toBe(1_814_140_800)
    const short = unwrap(parseLeapSecondsList(`#  File expires on 28 Jun 2027\n${rows}\n`))
    expect(short.expires).toBe(1_814_140_800)
  })
})

describe('numeric interop (offsets vs absolute epoch milliseconds)', () => {
  const instant = parseInstantOrThrow('2026-08-19T12:34:56.789012345Z')

  it('an offset from a nearby origin round-trips exactly, unlike absolute Unix millis', () => {
    const origin = truncateInstant(instant, 'day', 'utc')
    const offset = instantToOffsetMillis(instant, origin)
    expect(offset).toBe(45_296_789.012345)
    expect(instantsEqual(instantFromOffsetMillis(offset, origin), instant)).toBe(true)
    // The same value carried as absolute Unix milliseconds loses the sub-microsecond part.
    expect(instantsEqual(instantFromUnixMillis(instantToUnixMillis(instant)), instant)).toBe(false)
  })

  it('offset seconds round-trip exactly too', () => {
    const origin = truncateInstant(instant, 'hour', 'utc')
    const offset = instantToOffsetSeconds(instant, origin)
    expect(instantsEqual(instantFromOffsetSeconds(offset, origin), instant)).toBe(true)
  })

  it('reports the resolution actually available from absolute Unix millis', () => {
    // ~244 ns at present epochs: microseconds are marginal, nanoseconds impossible.
    const resolution = unixMillisResolutionNanos(instant)
    expect(resolution).toBeGreaterThan(200)
    expect(resolution).toBeLessThan(300)
    // Far from the epoch the magnitude is smaller, so the resolution is finer.
    expect(unixMillisResolutionNanos(parseInstantOrThrow('1970-01-02T00:00:00Z'))).toBeLessThan(
      resolution,
    )
    // Immediately below an exact power of two, doubles are twice as dense
    // as immediately above it. "Finest" means the smaller spacing.
    expect(unixMillisResolutionNanos(instantFromUnixMillis(2 ** 40))).toBe(122.0703125)
  })
})

describe('options passed where they do not belong', () => {
  const i = instantFromUnixMillis(1_787_142_896_789)

  // `scale` lives in the options bag for format/parse but is positional for
  // the scale converters. Passing it positionally here used to be accepted
  // in silence and the default scale used, so formatInstant(i, p, 'tai')
  // rendered a UTC reading 37 seconds away from the one asked for.
  it('rejects a bare scale where an options object belongs', () => {
    expect(() => formatInstant(i, 'HH:mm:ss', 'tai' as never)).toThrow(RangeError)
    expect(() => formatIso(i, 'tai' as never)).toThrow(/must be an object/)
    expect(() => parseInstant('2026-08-19T12:34:56', 'tai' as never)).toThrow(/must be an object/)
  })

  it('names the fix in the message, since the mistake is a near miss', () => {
    expect(() => formatInstant(i, 'HH:mm:ss', 'tai' as never)).toThrow(
      /Did you mean \{ scale: "tai" \}/,
    )
  })

  it('still accepts a real options object and an omitted one', () => {
    expect(formatInstant(i, 'HH:mm:ss', { scale: 'tai' })).toBe('12:35:33')
    expect(formatInstant(i, 'HH:mm:ss')).toBe('12:34:56')
    expect(formatInstant(i, 'HH:mm:ss', undefined)).toBe('12:34:56')
  })

  it('rejects null, which typeof reports as an object', () => {
    expect(() => formatInstant(i, 'HH:mm:ss', null as never)).toThrow(RangeError)
  })

  it('rejects every non-object shape without leaking a native TypeError', () => {
    for (const options of [1n, Symbol('options'), [], () => 0]) {
      expect(() => formatIso(i, options as never)).toThrow(RangeError)
    }
    expect(() => instantToScaleNanos(i, 'tai', 'ignored before this fix' as never)).toThrow(
      RangeError,
    )
    expect(() => deltaAtUnixSeconds(0, 'ignored before this fix' as never)).toThrow(RangeError)
  })

  it('rejects null option members instead of silently selecting defaults', () => {
    expect(() => formatIso(i, { scale: null } as never)).toThrow(RangeError)
    expect(() => formatIso(i, { precision: null } as never)).toThrow(RangeError)
    expect(() => formatIso(i, { designator: null } as never)).toThrow(RangeError)
    expect(() => parseInstant('2026-08-19', { format: null } as never)).toThrow(RangeError)
    expect(() => instantToUtc(i, { leapSeconds: null } as never)).toThrow(RangeError)
    expect(() => deltaAtUnixSeconds(0, { leapSeconds: null } as never)).toThrow(RangeError)
  })

  it('reports non-string pattern configuration without leaking a native TypeError', () => {
    expect(formatPatternError(null as never)).toContain('must be a string')
    expect(parsePatternError(null as never)).toContain('must be a string')
    expect(() => formatInstant(i, null as never)).toThrow(RangeError)
  })
})
