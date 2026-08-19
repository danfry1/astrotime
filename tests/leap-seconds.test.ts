import { describe, expect, it } from 'vitest'

import {
  deltaAt,
  deltaAtForUnixSeconds,
  formatIso,
  IERS_LEAP_SECONDS,
  isLeapSecondTableExpired,
  LeapSecondTableError,
  parseInstant,
  parseLeapSecondsList,
  unwrap,
} from '../src/index.js'

const IANA_SAMPLE = `#	Leap seconds list
#$	3992312697
#@	4023129600
2272060800	10	# 1 Jan 1972
2287785600	11	# 1 Jul 1972
2303683200	12	# 1 Jan 1973
`

const IERS_SAMPLE = `#  Value of TAI-UTC in second valid beetween the initial value until
#  the epoch given on the next line.
#
#  File expires on 28 June 2027
#
#    MJD        Date        TAI-UTC (s)
#           day month year
#    ---    --------------   ------
#
    41317.0    1  1 1972       10
    41499.0    1  7 1972       11
    41683.0    1  1 1973       12
`

describe('bundled table', () => {
  it('has 28 entries ending at 37 s and an expiry', () => {
    expect(IERS_LEAP_SECONDS.entries).toHaveLength(28)
    expect(IERS_LEAP_SECONDS.entries.at(-1)).toStrictEqual({
      unixSeconds: 1_483_228_800,
      deltaAt: 37,
    })
    expect(IERS_LEAP_SECONDS.expires).toBe(1_814_140_800)
  })

  it('is internally consistent (+1 per entry, ascending)', () => {
    for (let i = 1; i < IERS_LEAP_SECONDS.entries.length; i += 1) {
      const prev = IERS_LEAP_SECONDS.entries[i - 1]
      const cur = IERS_LEAP_SECONDS.entries[i]
      expect(cur?.deltaAt).toBe((prev?.deltaAt ?? 0) + 1)
      expect((cur?.unixSeconds ?? 0) > (prev?.unixSeconds ?? 0)).toBe(true)
    }
  })

  it('looks up ΔAT by Unix seconds', () => {
    expect(deltaAtForUnixSeconds(0)).toBe(10)
    expect(deltaAtForUnixSeconds(63_072_000)).toBe(10)
    expect(deltaAtForUnixSeconds(78_796_799)).toBe(10)
    expect(deltaAtForUnixSeconds(78_796_800)).toBe(11)
    expect(deltaAtForUnixSeconds(1_483_228_799)).toBe(36)
    expect(deltaAtForUnixSeconds(1_483_228_800)).toBe(37)
  })

  it('reports expiry', () => {
    expect(isLeapSecondTableExpired(IERS_LEAP_SECONDS, 1_814_140_799)).toBe(false)
    expect(isLeapSecondTableExpired(IERS_LEAP_SECONDS, 1_814_140_800)).toBe(true)
    expect(isLeapSecondTableExpired({ entries: [], expires: null }, 1e12)).toBe(false)
  })
})

describe('parseLeapSecondsList', () => {
  it('parses the IANA/NIST format including expiry', () => {
    const table = unwrap(parseLeapSecondsList(IANA_SAMPLE))
    expect(table).toStrictEqual({
      entries: [
        { unixSeconds: 63_072_000, deltaAt: 10 },
        { unixSeconds: 78_796_800, deltaAt: 11 },
        { unixSeconds: 94_694_400, deltaAt: 12 },
      ],
      expires: 1_814_140_800,
    })
  })

  it('parses the IERS Leap_Second.dat format including expiry', () => {
    const table = unwrap(parseLeapSecondsList(IERS_SAMPLE))
    expect(table).toStrictEqual({
      entries: [
        { unixSeconds: 63_072_000, deltaAt: 10 },
        { unixSeconds: 78_796_800, deltaAt: 11 },
        { unixSeconds: 94_694_400, deltaAt: 12 },
      ],
      expires: 1_814_140_800,
    })
  })

  it.each([
    ['', 0, 'no leap-second entries found'],
    ['#@ abc\n2272060800 10', 1, 'malformed #@ expiry'],
    ['# File expires on 28 Foo 2027\n2272060800 10', 1, 'unknown month in expiry'],
    ['2272060800 10\nhello world', 2, 'unrecognised line "hello world"'],
    ['2287785600 11\n2272060800 10', 2, 'entries are not in ascending order'],
    [
      '2272060800 10\n2287785600 12',
      2,
      'TAI−UTC must change by exactly one second between entries',
    ],
  ])('rejects %j', (text, line, reason) => {
    const result = parseLeapSecondsList(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(LeapSecondTableError)
      expect(result.error.toJSON()).toStrictEqual({ code: 'LEAP_SECOND_TABLE', line, reason })
    }
  })

  it('a parsed table drives UTC conversions', () => {
    const table = unwrap(parseLeapSecondsList(IANA_SAMPLE))
    const i = unwrap(parseInstant('2026-08-19T00:00:00Z', { leapSeconds: table }))
    expect(deltaAt(i, { leapSeconds: table })).toBe(12)
    expect(formatIso(i, { scale: 'tai' })).toBe('2026-08-19T00:00:12.000')
  })
})
