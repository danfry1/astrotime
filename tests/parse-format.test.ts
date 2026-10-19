import { describe, expect, it } from 'vitest'

import {
  formatInstant,
  formatIso,
  formatOrdinal,
  IERS_LEAP_SECONDS,
  InvalidTimeError,
  instantFromTaiNanos,
  instantsEqual,
  isValidFormatPattern,
  isValidInstant,
  type LeapSecondTable,
  parseInstant,
  parseInstantOrThrow,
  parsePatternError,
  TimeParseError,
  formatPatternError,
} from '../src/index.js'
import { expectErr, expectInstanceOf } from './helpers.js'

const iso = parseInstantOrThrow

describe('parseInstant iso', () => {
  it.each([
    ['2026-08-19T12:34:56.789012345Z', '2026-08-19T12:34:56.789012345Z'],
    ['2026-08-19T12:34:56Z', '2026-08-19T12:34:56.000000000Z'],
    ['2026-08-19T12:34Z', '2026-08-19T12:34:00.000000000Z'],
    ['2026-08-19', '2026-08-19T00:00:00.000000000Z'],
    ['2026-08-19 12:34:56.5', '2026-08-19T12:34:56.500000000Z'],
    ['2026-08-19T12:34:56,5', '2026-08-19T12:34:56.500000000Z'],
    ['2026-231T12:34:56.789Z', '2026-08-19T12:34:56.789000000Z'],
    ['2026-231', '2026-08-19T00:00:00.000000000Z'],
    ['2026-08-19T13:34:56+01:00', '2026-08-19T12:34:56.000000000Z'],
    ['2026-08-19T11:34:56-01', '2026-08-19T12:34:56.000000000Z'],
    ['2026-08-19T12:34:56+00:00', '2026-08-19T12:34:56.000000000Z'],
    ['2026-08-19T12:34:56-00:00', '2026-08-19T12:34:56.000000000Z'],
    ['+002026-08-19T12:34:56Z', '2026-08-19T12:34:56.000000000Z'],
    ['+010000-01-01T00:00:00Z', '+010000-01-01T00:00:00.000000000Z'],
    ['-0001-01-01T00:00:00Z', '-0001-01-01T00:00:00.000000000Z'],
    ['2016-12-31T23:59:60.5Z', '2016-12-31T23:59:60.500000000Z'],
    ['2017-01-01T00:00:37 TAI', '2017-01-01T00:00:00.000000000Z'],
    ['2017-01-01T00:00:37TAI', '2017-01-01T00:00:00.000000000Z'],
    ['2000-01-01T12:00:00 TT', '2000-01-01T11:58:55.816000000Z'],
    ['2026-231T00:00:18 GPS', '2026-08-19T00:00:00.000000000Z'],
  ])('parses %s', (text, expected) => {
    expect(formatIso(iso(text), { precision: 'nanos' })).toBe(expected)
  })

  it.each([
    [
      '2026-8-19',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    [
      '2026-08-19T12',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    [
      '2026-08-19T12:34:56.1234567890Z',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    [
      '20260819',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    ['', 'iso', 'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]'],
    [
      '10000-01-01',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    ['-0000-01-01', 'iso', 'negative-zero years are not allowed'],
    [
      '-00000-01-01',
      'iso',
      'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
    ],
    ['-000000-01-01', 'iso', 'negative-zero years are not allowed'],
    ['2026-08-19T12:00:00+24:00', 'iso', 'invalid UTC offset +24:00'],
    ['2026-08-19T12:00:00+00:60', 'iso', 'invalid UTC offset +00:60'],
    ['2026-08-19T12:00:00+99:99', 'iso', 'invalid UTC offset +99:99'],
    ['2026-08-19T12:34:56Z', 'ordinal', 'expected YYYY-DDD[THH:mm[:ss[.fff]]][Z|±HH:mm| TAI]'],
  ])('rejects %j under %s', (text, format, reason) => {
    const error = expectErr(parseInstant(text, { format }))
    expect(error).toBeInstanceOf(TimeParseError)
    expect(error.toJSON()).toStrictEqual({
      name: 'TimeParseError',
      code: 'TIME_PARSE',
      message: `Cannot parse ${JSON.stringify(text)} as ${format}: ${reason}`,
      input: text,
      reason,
      format,
    })
  })

  it('rejects negative-zero years in token-pattern parsing', () => {
    for (const text of ['-0000-01-01', '-000000-01-01']) {
      const parsed = parseInstant(text, { format: 'YYYY-MM-DD' })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error.reason).toBe('negative-zero years are not allowed')
    }
  })

  it('reports invalid field values', () => {
    const error = expectErr(parseInstant('2026-02-30T00:00:00Z'))
    expect(error).toBeInstanceOf(InvalidTimeError)
    expect(error.toJSON()).toStrictEqual({
      name: 'InvalidTimeError',
      code: 'INVALID_TIME',
      message: 'Invalid day 30: must be between 1 and 28',
      field: 'day',
      value: 30,
      reason: 'must be between 1 and 28',
    })
    expect(expectInstanceOf(expectErr(parseInstant('2023-366')), InvalidTimeError).field).toBe(
      'dayOfYear',
    )
    expect(() => parseInstantOrThrow('2023-366')).toThrow(InvalidTimeError)
  })

  it('applies leap-second rules to the UTC reading after an offset shift', () => {
    const leap = parseInstantOrThrow('2017-01-01T00:59:60.123456789+01:00')
    expect(formatIso(leap, { precision: 'nanos' })).toBe('2016-12-31T23:59:60.123456789Z')
    expect(instantsEqual(leap, parseInstantOrThrow('2017-01-01T05:44:60.123456789+05:45'))).toBe(
      true,
    )
    expect(expectErr(parseInstant('2017-01-01T00:58:60+01:00')).reason).toBe(
      '2017-01-01T00:58:60+01:00 is 2016-12-31T23:58:60 UTC; a leap second can only occur at 23:59:60',
    )
    const table: LeapSecondTable = {
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_893_456_000, deltaAt: 36 }],
      expires: null,
    }
    expect(
      expectErr(parseInstant('2030-01-01T00:59:59+01:00', { leapSeconds: table })).message,
    ).toBe(
      'Invalid second 59: 2030-01-01T00:59:59+01:00 is 2029-12-31T23:59:59 UTC; ' +
        'this second is deleted by a negative leap second',
    )
    expect(
      formatIso(iso('2030-01-01T00:59:58+01:00', { leapSeconds: table }), { leapSeconds: table }),
    ).toBe('2029-12-31T23:59:58.000Z')
  })

  it('returns a Result when an offset shifts an extreme year outside the civil range', () => {
    for (const text of ['-999999-01-01T00:00:00+23:00', '+999999-12-31T23:59:59-23:00']) {
      const parsed = parseInstant(text)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toBeInstanceOf(InvalidTimeError)
    }
  })

  it('names the UTC reading when a check fails after an offset shift', () => {
    // Each of these used to report a value the text never contained: the
    // input literally says 23:59:60, 1972 and 999999.
    const leap = expectInstanceOf(
      expectErr(parseInstant('2016-12-31T23:59:60.25+01:00')),
      InvalidTimeError,
    )
    expect(leap.message).toBe(
      'Invalid second 60: 2016-12-31T23:59:60.25+01:00 is 2016-12-31T22:59:60.25 UTC; ' +
        'a leap second can only occur at 23:59:60',
    )
    expect([leap.code, leap.field, leap.value]).toStrictEqual(['INVALID_TIME', 'second', 60])
    const early = expectInstanceOf(
      expectErr(parseInstant('1972-01-01T00:30:00+01:00', { before1972: 'reject' })),
      InvalidTimeError,
    )
    expect(early.message).toBe(
      'Invalid year 1971: 1972-01-01T00:30:00+01:00 is 1971-12-31T23:30:00 UTC; ' +
        'UTC is undefined before 1972-01-01',
    )
    const late = expectInstanceOf(
      expectErr(parseInstant('+999999-12-31T23:59:59-01:00')),
      InvalidTimeError,
    )
    expect(late.message).toBe(
      'Invalid year 1000000: +999999-12-31T23:59:59-01:00 is +1000000-01-01T00:59:59 UTC; ' +
        'must be between -999999 and 999999',
    )
    expect(expectErr(parseInstant('-999999-01-01T00:00:00+01:00')).message).toBe(
      'Invalid year -1000000: -999999-01-01T00:00:00+01:00 is -1000000-12-31T23:00:00 UTC; ' +
        'must be between -999999 and 999999',
    )
    // A field that is wrong before any shift is still reported as written.
    expect(expectErr(parseInstant('2026-02-29T00:30:00+01:00')).message).toBe(
      'Invalid day 29: must be between 1 and 28',
    )
  })

  it('rejects text whose instant falls outside the renderable civil range', () => {
    // '-999999-01-01T00:00:00 TT' parsed, and then formatIso and String()
    // both threw: its UTC reading is 42.184 s earlier, in year -1000000.
    for (const text of [
      '-999999-01-01T00:00:00 TT',
      '-999999-01-01T00:00:09.999999999 TAI',
      '-999999-001T00:00:00 TDB',
    ]) {
      const error = expectInstanceOf(expectErr(parseInstant(text)), InvalidTimeError)
      expect(error.toJSON()).toStrictEqual({
        name: 'InvalidTimeError',
        code: 'INVALID_TIME',
        message: `Invalid year -1000000: ${text} is before -999999-01-01T00:00:00 UTC, the start of the supported civil range`,
        field: 'year',
        value: -1_000_000,
        reason: `${text} is before -999999-01-01T00:00:00 UTC, the start of the supported civil range`,
      })
    }
    // GPS runs 19 s behind TAI, so the last GPS seconds of the range have a
    // TAI reading, and so a serialization, in year 1000000.
    expect(expectErr(parseInstant('+999999-12-31T23:59:50 GPS')).message).toBe(
      'Invalid year 1000000: +999999-12-31T23:59:50 GPS is after ' +
        '+999999-12-31T23:59:59.999999999 TAI, the end of the supported civil range',
    )
    expect(expectErr(parseInstant('+999999-12-31T23:59:59Z')).message).toMatch(
      /Invalid year 1000000: .* the end of the supported civil range/,
    )
    // The edges themselves parse and render in both directions.
    for (const text of [
      '-999999-01-01T00:00:00Z',
      '-999999-01-01T00:00:10 TAI',
      '-999999-01-01T00:00:42.184 TT',
      '+999999-12-31T23:59:59.999999999 TAI',
      '+999999-12-31T23:59:40.999999999 GPS',
    ]) {
      const instant = parseInstantOrThrow(text)
      expect(String(instant)).toMatch(/ TAI$/)
      expect(
        instantsEqual(parseInstantOrThrow(formatIso(instant, { precision: 'nanos' })), instant),
      ).toBe(true)
    }
  })

  it('rejects Z or a UTC offset on a bare date but keeps a scale label', () => {
    // ISO 8601 attaches Z and offsets to a time of day only; '2026-08-19+01:00'
    // was read as 23:00 UTC on the 18th, a time the text never stated.
    for (const [text, format, designator] of [
      ['2026-08-19+01:00', 'iso', '+01:00'],
      ['2026-08-19-05', 'iso', '-05'],
      ['2026-08-19Z', 'iso', 'Z'],
      ['2026-231Z', 'iso', 'Z'],
      ['2026-231Z', 'ordinal', 'Z'],
    ] as const) {
      const error = expectInstanceOf(expectErr(parseInstant(text, { format })), TimeParseError)
      expect(error.reason).toBe(
        `${designator} needs a time of day; ISO 8601 has no UTC offset on a date alone`,
      )
    }
    // A scale label names the clock the date is read on (a TAI date).
    expect(formatIso(iso('2017-01-01 TAI'), { scale: 'tai' })).toBe('2017-01-01T00:00:00.000 TAI')
    expect(formatOrdinal(iso('2026-231 GPS'), { scale: 'gps' })).toBe('2026-231T00:00:00.000 GPS')
    expect(isValidInstant('2026-08-19T00:00Z')).toBe(true)
  })

  it('reads only the documented extended-format offsets and year widths', () => {
    // A basic-format offset inside extended text, and a signed year without
    // the six digits an expanded year carries, were both accepted.
    for (const text of [
      '2016-12-31T23:59:60+0100',
      '2026-08-19T07:04:56-0530',
      '+2026-08-19',
      '+0000-01-01',
      '-12345-01-01',
      '+12345-01-01T00:00:00Z',
    ]) {
      expect(expectInstanceOf(expectErr(parseInstant(text)), TimeParseError).reason).toBe(
        'expected YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]',
      )
    }
    // ±HH alone is ISO 8601 in either format, and the Z token writes a scale
    // label without a space, which therefore still reads back.
    expect(formatIso(iso('2026-08-19T11:34:56-01'))).toBe('2026-08-19T12:34:56.000Z')
    expect(formatIso(iso('2026-08-19T07:04:56-05:30'))).toBe('2026-08-19T12:34:56.000Z')
    expect(formatIso(iso('+002026-08-19T00:00:00Z'))).toBe('2026-08-19T00:00:00.000Z')
    expect(formatIso(iso('-0044-03-15T00:00:00Z'))).toBe('-0044-03-15T00:00:00.000Z')
    const tai = formatInstant(iso('2017-01-01T00:00:00Z'), 'YYYY-MM-DD[T]HH:mm:ssZ', {
      scale: 'tai',
    })
    expect(tai).toBe('2017-01-01T00:00:37TAI')
    expect(formatIso(iso(tai))).toBe('2017-01-01T00:00:00.000Z')
  })

  it('resolves scales from designators and the scale option', () => {
    expect(formatIso(iso('2017-01-01T00:00:37', { scale: 'tai' }))).toBe('2017-01-01T00:00:00.000Z')
    expect(formatIso(iso('2017-01-01T00:00:37 TAI', { scale: 'tai' }))).toBe(
      '2017-01-01T00:00:00.000Z',
    )
    expect(expectErr(parseInstant('2017-01-01T00:00:37Z', { scale: 'tai' })).message).toBe(
      'Cannot parse "2017-01-01T00:00:37Z" as iso: text is in UTC but TAI was requested',
    )
    expect(expectErr(parseInstant('2017-01-01T00:00:37 TT', { scale: 'tai' })).message).toBe(
      'Cannot parse "2017-01-01T00:00:37 TT" as iso: text is in TT but TAI was requested',
    )
    expect(expectErr(parseInstant('2017-01-01T00:00:37+01:00', { scale: 'tai' })).message).toBe(
      'Cannot parse "2017-01-01T00:00:37+01:00" as iso: a UTC offset is not valid for the TAI scale',
    )
    expect(expectErr(parseInstant('2016-12-31T23:59:60', { scale: 'tt' })).message).toBe(
      'Invalid second 60: TT has no leap seconds',
    )
    expect(expectErr(parseInstant('2016-12-31T23:59:60 TT')).message).toBe(
      'Invalid second 60: TT has no leap seconds',
    )
  })

  it('ordinal format accepts only day-of-year text', () => {
    expect(formatIso(iso('2026-231T12:00', { format: 'ordinal' }))).toBe('2026-08-19T12:00:00.000Z')
    expect(isValidInstant('2026-08-19', { format: 'ordinal' })).toBe(false)
    expect(isValidInstant('2026-231')).toBe(true)
  })
})

describe('token patterns', () => {
  it.each([
    ['YYYY-MM-DD HH:mm:ss.SSS', '2026-08-19 12:34:56.789', '2026-08-19T12:34:56.789Z'],
    ['YYYY-MM-DD HH:mm:ss', '2026-08-19 12:34:56', '2026-08-19T12:34:56.000Z'],
    ['YYYY-MM-DD HH:mm', '2026-08-19 12:34', '2026-08-19T12:34:00.000Z'],
    ['YYYY-MM-DD', '2026-08-19', '2026-08-19T00:00:00.000Z'],
    ['YYYY-DDD[T]HH:mm:ss.SSSSSS', '2026-231T12:34:56.789012', '2026-08-19T12:34:56.789Z'],
    ['YYYY-MM-DD[T]HH:mm:ss.SSSZ', '2026-08-19T12:34:56.789Z', '2026-08-19T12:34:56.789Z'],
    ['YYYYDDDHHmmss', '2026231123456', '2026-08-19T12:34:56.000Z'],
    ['DD/MM/YYYY', '19/08/2026', '2026-08-19T00:00:00.000Z'],
    ['YYYY', '2026', '2026-01-01T00:00:00.000Z'],
    ['YYYY.MM.DD (HH+mm)', '2026.08.19 (12+34)', '2026-08-19T12:34:00.000Z'],
    ['YYYY-MM-DD', '-0044-03-15', '-0044-03-15T00:00:00.000Z'],
  ])('round-trips %s', (pattern, text, expectedIso) => {
    const instant = iso(text, { format: pattern })
    expect(formatIso(instant)).toBe(expectedIso)
    expect(formatInstant(instant, pattern)).toBe(text)
  })

  it('is strict about widths, literals and adjacent tokens', () => {
    expect(isValidInstant('2026-08-19 12:34:56', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })).toBe(false)
    expect(isValidInstant('2026-08-19T12:34:56', { format: 'YYYY-MM-DD HH:mm:ss' })).toBe(false)
    expect(isValidInstant('2026-08-19 12:34:56.1234', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })).toBe(
      false,
    )
    expect(isValidInstant('20262311', { format: 'YYYYDDD' })).toBe(false)
    expect(isValidInstant('2026231', { format: 'YYYYDDD' })).toBe(true)
    expect(expectErr(parseInstant('2026-08-19', { format: 'YYYY/MM/DD' })).toJSON()).toStrictEqual({
      name: 'TimeParseError',
      code: 'TIME_PARSE',
      message: 'Cannot parse "2026-08-19" as YYYY/MM/DD: does not match pattern YYYY/MM/DD',
      input: '2026-08-19',
      reason: 'does not match pattern YYYY/MM/DD',
      format: 'YYYY/MM/DD',
    })
  })

  it('requires a year token', () => {
    // A pattern that cannot name a date is a defect in the caller's source,
    // so it throws rather than reporting the text as unparseable.
    expect(() => parseInstant('12:34:56', { format: 'HH:mm:ss' })).toThrow(
      /Parse pattern "HH:mm:ss" is invalid: no year \(YYYY\)/,
    )
  })

  it('treats Z as the scale designator in both directions', () => {
    const i = iso('2017-01-01T00:00:00Z')
    expect(formatInstant(i, 'YYYY-MM-DD[T]HH:mm:ssZ')).toBe('2017-01-01T00:00:00Z')
    expect(formatInstant(i, 'YYYY-MM-DD[T]HH:mm:ss Z', { scale: 'tai' })).toBe(
      '2017-01-01T00:00:37 TAI',
    )
    expect(formatInstant(i, 'YYYY-MM-DD[T]HH:mm:ss Z', { scale: 'gps' })).toBe(
      '2017-01-01T00:00:18 GPS',
    )
    expect(
      instantsEqual(iso('2017-01-01T00:00:37 TAI', { format: 'YYYY-MM-DD[T]HH:mm:ss Z' }), i),
    ).toBe(true)
    expect(
      instantsEqual(
        iso('2017-01-01T00:00:37 TAI', { format: 'YYYY-MM-DD[T]HH:mm:ss Z', scale: 'tai' }),
        i,
      ),
    ).toBe(true)
    expect(
      expectErr(
        parseInstant('2017-01-01T00:00:00Z', { format: 'YYYY-MM-DD[T]HH:mm:ssZ', scale: 'tdb' }),
      ).message,
    ).toBe(
      'Cannot parse "2017-01-01T00:00:00Z" as YYYY-MM-DD[T]HH:mm:ssZ: text is in UTC but TDB was requested',
    )
  })

  it('formats negative and expanded years, and honours bracketed literals', () => {
    const bce = iso('-0044-03-15T00:00:00Z')
    expect(formatInstant(bce, 'YYYY-MM-DD [x]')).toBe('-0044-03-15 x')
    expect(formatInstant(bce, '[YYYY]')).toBe('YYYY')
    expect(formatInstant(iso('+012345-01-01T00:00:00Z'), 'YYYY')).toBe('+012345')
  })

  it('rejects stray letters rather than rendering them verbatim', () => {
    const bce = iso('-0044-03-15T00:00:00Z')
    expect(() => formatInstant(bce, 'YYYY-MM-DD x')).toThrow(RangeError)
    // An unterminated bracket is a typo, not a literal.
    expect(() => formatInstant(bce, 'YYYY [unterminated')).toThrow(RangeError)
  })
})

describe('formatIso / formatOrdinal', () => {
  const i = iso('2026-08-19T12:34:56.789012000Z')
  it.each([
    ['seconds', '2026-08-19T12:34:56Z'],
    ['millis', '2026-08-19T12:34:56.789Z'],
    ['micros', '2026-08-19T12:34:56.789012Z'],
    ['nanos', '2026-08-19T12:34:56.789012000Z'],
    ['auto', '2026-08-19T12:34:56.789012Z'],
  ] as const)('%s', (precision, expected) => {
    expect(formatIso(i, { precision })).toBe(expected)
  })

  it('auto precision picks the shortest exact fraction', () => {
    expect(formatIso(iso('2026-08-19T12:34:56Z'), { precision: 'auto' })).toBe(
      '2026-08-19T12:34:56Z',
    )
    expect(formatIso(iso('2026-08-19T12:34:56.5Z'), { precision: 'auto' })).toBe(
      '2026-08-19T12:34:56.500Z',
    )
    expect(formatIso(iso('2026-08-19T12:34:56.000000001Z'), { precision: 'auto' })).toBe(
      '2026-08-19T12:34:56.000000001Z',
    )
  })

  it('appends scale designators for non-UTC scales unless told not to', () => {
    expect(formatIso(i, { scale: 'gps', precision: 'seconds' })).toBe('2026-08-19T12:35:14 GPS')
    expect(formatIso(i, { scale: 'gps', precision: 'seconds', designator: 'none' })).toBe(
      '2026-08-19T12:35:14',
    )
    expect(formatIso(i, { designator: 'none' })).toBe('2026-08-19T12:34:56.789')
    expect(formatOrdinal(i)).toBe('2026-231T12:34:56.789')
    expect(formatOrdinal(i, { scale: 'tt', precision: 'auto' })).toBe('2026-231T12:36:05.973012 TT')
    expect(formatOrdinal(i, { scale: 'tt', precision: 'auto', designator: 'none' })).toBe(
      '2026-231T12:36:05.973012',
    )
    expect(instantsEqual(iso(formatIso(i, { scale: 'tdb', precision: 'nanos' })), i)).toBe(true)
  })

  it('rejects invalid runtime formatting and parsing options with RangeError', () => {
    const instant = parseInstantOrThrow('2026-08-19T00:00:00Z')
    expect(() => formatIso(instant, { precision: 'bad' as never })).toThrow(RangeError)
    expect(() => formatIso(instant, { designator: 'bad' as never })).toThrow(RangeError)
    expect(() => parseInstant('2026-08-19', { scale: 'bad' as never })).toThrow(RangeError)
  })

  it('formats instants before 1970 and before 1972', () => {
    expect(formatIso(instantFromTaiNanos(0n))).toBe('1969-12-31T23:59:50.000Z')
  })
})

describe('format pattern validation', () => {
  const i = iso('2026-08-19T12:34:56.789Z')

  it.each([
    ['YYYY-MM-DD HH:mm:ss.SSS', null],
    ['YYYY-MM-DD[T]HH:mm:ss[Z]', null],
    ['YYYY-DDD[T]HH:mm:ss.SSSSSSSSS', null],
    // DD and DDD are different fields, so a pattern may carry both.
    ['YYYY-MM-DD [(doy )]DDD', null],
    ['YYYY[]MM', null],
    // A ] outside a bracket renders exactly as written, so it hides nothing.
    ['YYYY ]', null],
    ['', null],
    ['YYYY-MM-DD hh:mm:ss.ms', 'unknown token(s) "hh", "ms"'],
    ['qq YYYY zz qq', 'unknown token(s) "qq", "zz"'],
    // The Moment-ism that silently loses the T.
    ['YYYY-MM-DDTHH:mm:ss', 'unknown token(s) "T"'],
  ] as const)('accepts or explains %j', (pattern, expected) => {
    expect(formatPatternError(pattern)).toBe(expected)
    expect(isValidFormatPattern(pattern)).toBe(expected === null)
  })

  it('rejects an unterminated bracket, which would swallow the rest as literal', () => {
    // 'YYYY [123' used to render '2026 123': the bracket vanishes silently.
    for (const pattern of ['YYYY [', 'YYYY [123', 'YYYY [MM']) {
      expect(formatPatternError(pattern)).toMatch(/unterminated "\["/)
      expect(() => formatInstant(i, pattern)).toThrow(RangeError)
    }
  })

  it('rejects a letter run longer than its token, which would not read back', () => {
    // 'SSSSSSSSSS' split into SSSSSSSSS + S and rendered '.7890000007',
    // which parses back as .700000000 — a silent corruption.
    const pattern = 'YYYY-MM-DD HH:mm:ss.SSSSSSSSSS'
    expect(formatPatternError(pattern)).toMatch(/longer than the longest "S" token/)
    expect(() => formatInstant(i, pattern)).toThrow(RangeError)
    for (const overlong of ['MMM', 'HHH', 'ZZ', 'YYYYY']) {
      expect(isValidFormatPattern(overlong)).toBe(false)
    }
  })

  it('rejects the same field twice, which would repeat a number', () => {
    expect(formatPatternError('HH:mm HH:mm')).toMatch(/appears more than once/)
    expect(() => formatInstant(i, 'YYYY-MM-DD DD')).toThrow(RangeError)
  })

  it('reports stray letters per run, not merged across what separates them', () => {
    // These once reported a token "xy" / "xyz" that appears nowhere in the
    // pattern. A bracketed literal ends a run just as a field token does.
    expect(formatPatternError('xYYYYy')).toBe('unknown token(s) "x", "y"')
    expect(formatPatternError('x[foo]y')).toBe('unknown token(s) "x", "y"')
    expect(formatPatternError('x[a]y[b]z')).toBe('unknown token(s) "x", "y", "z"')
  })

  it('treats a non-ASCII letter as literal text, since no token is one', () => {
    // Rejecting every non-ASCII letter would reject a legitimate localised
    // pattern; the cost is that a Latin-looking homoglyph passes as literal.
    expect(formatPatternError('YYYY年MM月DD日')).toBeNull()
    expect(formatInstant(i, 'YYYY年MM月DD日')).toBe('2026年08月19日')
  })

  it('names the offending tokens when formatting rejects a pattern', () => {
    // The silent-failure case this exists to prevent: the pattern looks
    // plausible and would otherwise render plausible-but-wrong output.
    const pattern = 'YYYY-MM-DD hh:mm:ss.ms'
    expect(() => formatInstant(i, pattern)).toThrow(/unknown token\(s\) "hh", "ms"/)
  })

  it('checks a pattern once however many times it is used', () => {
    // Validation is folded into the bounded token cache, so a hot format
    // loop pays for it once and no per-pattern set grows without limit.
    for (let n = 0; n < 1000; n += 1) {
      expect(formatInstant(i, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-08-19 12:34:56')
    }
    for (let n = 0; n < 600; n += 1) {
      expect(() => formatInstant(i, `[p${String(n)}]YYYY`)).not.toThrow()
    }
  })
})

describe('parse pattern validation', () => {
  it('blames the pattern, not the text, for a defective pattern', () => {
    // Before: this returned a Result error saying the *text* did not match,
    // which sends the reader looking for a bug in their data.
    expect(() => parseInstant('2026-08-19 12:34:56', { format: 'YYYY-MM-DD hh:mm:ss' })).toThrow(
      /unknown token\(s\) "hh"/,
    )
    expect(() => parseInstant('2026', { format: 'YYYY [' })).toThrow(RangeError)
  })

  it('separates what parsing needs from what formatting needs', () => {
    // 'HH:mm' renders perfectly well and names no instant to read back, so
    // one validator cannot answer for both directions.
    expect(formatPatternError('HH:mm')).toBeNull()
    expect(parsePatternError('HH:mm')).toMatch(/no year \(YYYY\)/)
    expect(parsePatternError('YYYY-MM-DD HH:mm')).toBeNull()
    expect(parsePatternError('iso')).toBeNull()
    expect(parsePatternError('ordinal')).toBeNull()
  })

  it('rejects DDD alongside only part of a calendar date', () => {
    // 'YYYY-MM DDD' silently ignored the month it was given and returned the
    // date DDD named, so a parse of '2026-12 231' came back as 19 August.
    expect(parsePatternError('YYYY-MM DDD')).toMatch(/combines DDD with MM but not DD/)
    expect(parsePatternError('YYYY-DD DDD')).toMatch(/combines DDD with DD but not MM/)
    expect(() => parseInstant('2026-12 231', { format: 'YYYY-MM DDD' })).toThrow(RangeError)
    // A complete calendar date is cross-checked, and an ordinal-only one stands.
    expect(parsePatternError('YYYY-MM-DD DDD')).toBeNull()
    expect(parsePatternError('YYYY DDD')).toBeNull()
  })

  it('rejects a pattern that reads a field below a missing one', () => {
    // 'YYYY DD' read "2026 19" as 19 January: the month defaulted in silence.
    expect(parsePatternError('YYYY DD')).toBe('reads DD without MM, which would silently default')
    expect(() => parseInstant('2026 19', { format: 'YYYY DD' })).toThrow(
      /reads DD without MM, which would silently default/,
    )
    expect(parsePatternError('YYYY mm')).toBe('reads mm without HH, which would silently default')
    expect(parsePatternError('YYYY-MM-DD HH ss')).toBe(
      'reads ss without mm, which would silently default',
    )
    expect(parsePatternError('YYYY-MM HH')).toBe(
      'reads HH without DD or DDD, which would silently default',
    )
    expect(parsePatternError('YYYY-MM-DD HH:mm.SSS')).toBe(
      'reads S…S without ss, which would silently default',
    )
    // Stopping early is reduced precision, not a gap; DDD supplies the day.
    for (const pattern of ['YYYY', 'YYYY-MM', 'YYYY-MM-DD HH', 'YYYY-DDD HH:mm', 'YYYYDDDHHmmss'])
      expect(parsePatternError(pattern)).toBeNull()
    // Formatting renders exactly the fields asked for, so a gap is harmless there.
    expect(formatPatternError('YYYY DD')).toBeNull()
    expect(formatInstant(iso('2026-08-19T12:34:56Z'), 'mm:ss')).toBe('34:56')
  })

  it('rejects a pattern with no year whatever the text is', () => {
    // Thrown at compile time, so it does not depend on the text matching.
    expect(() => parseInstant('12:34', { format: 'HH:mm' })).toThrow(/no year \(YYYY\)/)
    expect(() => parseInstant('nonsense', { format: 'HH:mm' })).toThrow(/no year \(YYYY\)/)
  })

  it('cross-checks day-of-year against month/day when a pattern carries both', () => {
    const agreeing = parseInstant('2026-08-19 231', { format: 'YYYY-MM-DD DDD' })
    expect(agreeing.ok).toBe(true)
    const conflicting = parseInstant('2026-08-19 001', { format: 'YYYY-MM-DD DDD' })
    expect(conflicting.ok).toBe(false)
  })

  it('still reports a genuine text mismatch as a Result', () => {
    const result = parseInstant('not a date', { format: 'YYYY-MM-DD' })
    expect(result.ok).toBe(false)
  })
})
