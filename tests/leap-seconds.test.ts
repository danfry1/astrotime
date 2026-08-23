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

  it('rejects a safe entry whose corresponding TAI boundary is not safe', () => {
    expect(
      expectErr(
        validateLeapSecondTable({
          entries: [{ unixSeconds: Number.MAX_SAFE_INTEGER, deltaAt: 1 }],
          expires: null,
        }),
      ).reason,
    ).toBe('entry TAI boundaries must be safe integers')
  })

  it('detects corruption of either field in the known history', () => {
    const wrongUnix = IERS_LEAP_SECONDS.entries.map((entry, index) =>
      index === 0 ? { ...entry, unixSeconds: entry.unixSeconds - 86_400 } : { ...entry },
    )
    expect(
      expectErr(validateLeapSecondTable({ entries: wrongUnix, expires: null })).reason,
    ).toContain('entry 0 must match the known leap-second history')

    // Changing the final +1 leap to a -1 leap keeps the table structurally
    // valid, isolating the known deltaAt comparison from sequence validation.
    const wrongDelta = IERS_LEAP_SECONDS.entries.map((entry, index) =>
      index === IERS_LEAP_SECONDS.entries.length - 1
        ? { ...entry, deltaAt: entry.deltaAt - 2 }
        : { ...entry },
    )
    expect(
      expectErr(validateLeapSecondTable({ entries: wrongDelta, expires: null })).reason,
    ).toContain('entry 27 must match the known leap-second history')
  })

  it('accepts exactly 10000 lines and rejects the next line', () => {
    const rows = IANA_FULL.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
    const atLimit = [...Array<string>(10_000 - rows.length).fill('# comment'), ...rows].join('\n')
    expect(atLimit.split('\n')).toHaveLength(10_000)
    expect(parseLeapSecondsList(atLimit).ok).toBe(true)
    const error = expectErr(parseLeapSecondsList(`# one too many\n${atLimit}`))
    expect(error.reason).toBe('list exceeds 10000 lines')
    expect(error.line).toBe(10_001)
  })

  it('rejects every duplicate metadata form', () => {
    const rows = IANA_FULL.split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .join('\n')
    expect(expectErr(parseLeapSecondsList(`#$ 3992312697\n#$ 3992312697\n${rows}`)).reason).toBe(
      'duplicate #$ update stamp',
    )
    expect(
      expectErr(
        parseLeapSecondsList(
          `# File expires on 28 June 2027\n# File expires on 28 June 2027\n${rows}`,
        ),
      ).reason,
    ).toBe('duplicate IERS expiry')
  })

  it('rejects mixed IANA and IERS rows in either order', () => {
    expect(expectErr(parseLeapSecondsList('2272060800 10\n41499.0 1 7 1972 11')).reason).toBe(
      'cannot mix IANA and IERS data rows',
    )
    expect(expectErr(parseLeapSecondsList('41317.0 1 1 1972 10\n2287785600 11')).reason).toBe(
      'cannot mix IANA and IERS data rows',
    )
  })

  it('validates every IERS calendar boundary explicitly', () => {
    for (const row of [
      '15020.0 1 1 1899 10',
      '197687.0 1 1 2401 10',
      '41317.0 1 0 1972 10',
      '41317.0 1 13 1972 10',
      '41317.0 0 1 1972 10',
      '41317.0 32 1 1972 10',
      '41317.0 29 2 1973 10',
    ]) {
      expect(expectErr(parseLeapSecondsList(row)).reason).toBe(
        'day/month/year columns are not a real date',
      )
    }

    const rows = IERS_FULL.split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
    expect(
      unwrap(parseLeapSecondsList(`# File expires on 31 December 2400\n${rows}`)).expires,
    ).toBe(Date.UTC(2400, 11, 31) / 1000)
    expect(
      expectErr(parseLeapSecondsList(`# File expires on 1 January 1900\n${rows}`)).reason,
    ).toBe('expires must be later than the final leap-second entry')
  })

  it('accepts deliberate IERS lexical variants and rejects prefix/suffix garbage', () => {
    const integerMjd = IERS_FULL.replace('41317.0', '41317')
    expect(parseLeapSecondsList(integerMjd).ok).toBe(true)

    const signedDeltaAndLongFraction = IERS_FULL.replace(
      '41317.0    1  1 1972       10',
      '41317.00    1  1 1972       +10  # explicit positive offset',
    )
    expect(parseLeapSecondsList(signedDeltaAndLongFraction).ok).toBe(true)

    for (const text of [
      IERS_FULL.replace('41317.0', 'x41317.0'),
      IERS_FULL.replace('41317.0    1  1 1972       10', '41317.0 1 1 1972 10 garbage'),
      IERS_FULL.replace(
        '#  File expires on 28 June 2027',
        '#  File expires on 28 June 2027 garbage',
      ),
    ]) {
      expect(parseLeapSecondsList(text).ok).toBe(false)
    }
    expect(
      expectErr(
        parseLeapSecondsList(
          IERS_FULL.replace(
            '#  File expires on 28 June 2027',
            '#  File expires on 28 June 2027 garbage',
          ),
        ),
      ).reason,
    ).toBe('malformed IERS expiry')
  })

  it('accepts IANA whitespace/sign/comment variants without weakening anchors', () => {
    const body = IANA_FULL.split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .join('\n')
    const varied = body
      .replace('2272060800\t10\t# entry', '2272060800   +10    #')
      .replace('2287785600\t11\t# entry', '2287785600  11  # two spaces')
    expect(parseLeapSecondsList(varied).ok).toBe(true)
    expect(parseLeapSecondsList(`prefix${varied}`).ok).toBe(false)
    expect(
      parseLeapSecondsList(varied.replace('3692217600\t37\t# entry', '3692217600 37 suffix')).ok,
    ).toBe(false)
  })

  it('a parsed table drives UTC conversions with the real modern offset', () => {
    const leapSeconds = unwrap(parseLeapSecondsList(IANA_FULL))
    const i = parseInstantOrThrow('2026-08-19T00:00:00Z', { leapSeconds })
    expect(deltaAt(i, { leapSeconds })).toBe(37)
    expect(formatIso(i, { scale: 'tai', leapSeconds })).toBe('2026-08-19T00:00:37.000 TAI')
  })
})
