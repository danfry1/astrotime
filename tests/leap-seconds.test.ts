import { describe, expect, it } from 'vitest'

import {
  deltaAt,
  deltaAtUnixSeconds,
  formatIso,
  IERS_LEAP_SECONDS,
  LeapSecondTableError,
  parseInstantOrThrow,
  parseLeapSecondsList,
  unwrap,
  validateLeapSecondTable,
} from '../src/index.js'
import { expectErr } from './helpers.js'

const NTP_OFFSET = 2_208_988_800

/** Full IANA/NIST leap-seconds.list text generated from the bundled table. */
const IANA_FULL = [
  '#\tLeap seconds list',
  '#$\t3992312697',
  '#@\t4023129600',
  ...IERS_LEAP_SECONDS.entries.map(
    (e) => `${String(e.unixSeconds + NTP_OFFSET)}\t${String(e.deltaAt)}\t# entry`,
  ),
  '',
].join('\n')

/** Full IERS Leap_Second.dat text generated from the bundled table. */
const IERS_FULL = [
  '#  File expires on 28 June 2027',
  '#    MJD        Date        TAI-UTC (s)',
  ...IERS_LEAP_SECONDS.entries.map((e) => {
    const date = new Date(e.unixSeconds * 1000)
    const mjd = e.unixSeconds / 86_400 + 40_587
    return `    ${String(mjd)}.0    ${String(date.getUTCDate())}  ${String(date.getUTCMonth() + 1)} ${String(date.getUTCFullYear())}       ${String(e.deltaAt)}`
  }),
  '',
].join('\n')

const FULL_ENTRIES = IERS_LEAP_SECONDS.entries.map((e) => ({ ...e }))

describe('bundled table', () => {
  it('has 28 entries ending at 37 s, an expiry and an update stamp', () => {
    expect(IERS_LEAP_SECONDS.entries).toHaveLength(28)
    expect(IERS_LEAP_SECONDS.entries.at(-1)).toStrictEqual({
      unixSeconds: 1_483_228_800,
      deltaAt: 37,
    })
    expect(IERS_LEAP_SECONDS.expires).toBe(1_814_140_800)
    expect(IERS_LEAP_SECONDS.updated).toBe(1_783_323_897)
    expect(validateLeapSecondTable(IERS_LEAP_SECONDS).ok).toBe(true)
  })

  it('looks up ΔAT by Unix seconds', () => {
    expect(deltaAtUnixSeconds(0)).toBe(10)
    expect(deltaAtUnixSeconds(63_072_000)).toBe(10)
    expect(deltaAtUnixSeconds(78_796_799)).toBe(10)
    expect(deltaAtUnixSeconds(78_796_800)).toBe(11)
    expect(deltaAtUnixSeconds(1_483_228_799)).toBe(36)
    expect(deltaAtUnixSeconds(1_483_228_800)).toBe(37)
    expect(() =>
      deltaAtUnixSeconds(1_483_228_800, { leapSeconds: { entries: [], expires: null } }),
    ).toThrow(new RangeError('Invalid leap-second table: table has no entries'))
  })
})

describe('parseLeapSecondsList', () => {
  it('parses the IANA/NIST format including expiry and update stamp', () => {
    expect(unwrap(parseLeapSecondsList(IANA_FULL))).toStrictEqual({
      entries: FULL_ENTRIES,
      expires: 1_814_140_800,
      updated: 1_783_323_897,
    })
  })

  it('parses the IERS Leap_Second.dat format including expiry', () => {
    expect(unwrap(parseLeapSecondsList(IERS_FULL))).toStrictEqual({
      entries: FULL_ENTRIES,
      expires: 1_814_140_800,
      updated: null,
    })
  })

  it('prefers the #@ expiry when both forms are present', () => {
    const text = `#@ 4023129600\n# File expires on 1 January 2030\n${IANA_FULL.split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n')}`
    expect(unwrap(parseLeapSecondsList(text)).expires).toBe(1_814_140_800)
  })

  it.each([
    ['', 0, 'no leap-second entries found'],
    ['#@ abc\n2272060800 10', 1, 'malformed #@ expiry'],
    ['#$ abc\n2272060800 10', 1, 'malformed #$ update stamp'],
    ['# File expires on 28 Foo 2027\n2272060800 10', 1, 'unknown month in expiry'],
    ['2272060800 10\nhello world', 2, 'unrecognised line "hello world"'],
    ['2287785600 11\n2272060800 10', 2, 'entries are not in ascending order'],
    [
      '2272060800 10\n2287785600 12',
      2,
      'TAI−UTC must change by exactly one second between entries',
    ],
    ['2272060801 10', 1, 'entries must start at a UTC midnight'],
    [
      '2287785600 11',
      1,
      'table must include the complete known leap-second history (got 1 of 28 known entries)',
    ],
  ])('rejects %j', (text, line, reason) => {
    const error = expectErr(parseLeapSecondsList(text))
    expect(error).toBeInstanceOf(LeapSecondTableError)
    expect(error.toJSON()).toStrictEqual({
      name: 'LeapSecondTableError',
      code: 'LEAP_SECOND_TABLE',
      message: `Invalid leap-second table at line ${String(line)}: ${reason}`,
      line,
      reason,
    })
  })

  it('validateLeapSecondTable reports problems in hand-built tables', () => {
    expect(
      expectErr(
        validateLeapSecondTable({ entries: [{ unixSeconds: 0.5, deltaAt: 10 }], expires: null }),
      ).reason,
    ).toBe('entries must be safe integers')
  })

  it('a parsed table drives UTC conversions with the real modern offset', () => {
    const leapSeconds = unwrap(parseLeapSecondsList(IANA_FULL))
    const i = parseInstantOrThrow('2026-08-19T00:00:00Z', { leapSeconds })
    expect(deltaAt(i, { leapSeconds })).toBe(37)
    expect(formatIso(i, { scale: 'tai', leapSeconds })).toBe('2026-08-19T00:00:37.000 TAI')
  })
})
