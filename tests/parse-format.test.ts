import { describe, expect, it } from 'vitest'

import {
  formatInstant,
  formatIso,
  formatOrdinal,
  IERS_LEAP_SECONDS,
  InvalidTimeError,
  instantFromTaiNanos,
  instantsEqual,
  isValidInstant,
  type LeapSecondTable,
  parseInstant,
  parseInstantOrThrow,
  TimeParseError,
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
    ['2026-08-19T07:04:56-0530', '2026-08-19T12:34:56.000000000Z'],
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
    ['-0000-01-01', 'iso', 'year -0000 is not allowed'],
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
    expect(expectErr(parseInstant('2017-01-01T00:59:60+01:00')).message).toBe(
      'Invalid second 60: a leap second with a non-zero UTC offset is not supported',
    )
    const table: LeapSecondTable = {
      entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_893_456_000, deltaAt: 36 }],
      expires: null,
    }
    expect(
      expectErr(parseInstant('2030-01-01T00:59:59+01:00', { leapSeconds: table })).message,
    ).toBe('Invalid second 59: this second is deleted by a negative leap second')
    expect(
      formatIso(iso('2030-01-01T00:59:58+01:00', { leapSeconds: table }), { leapSeconds: table }),
    ).toBe('2029-12-31T23:59:58.000Z')
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
    expect(expectErr(parseInstant('12:34:56', { format: 'HH:mm:ss' })).message).toBe(
      'Cannot parse "12:34:56" as HH:mm:ss: pattern must include a year (YYYY)',
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

  it('formats negative and expanded years, unknown letters and unterminated brackets', () => {
    const bce = iso('-0044-03-15T00:00:00Z')
    expect(formatInstant(bce, 'YYYY-MM-DD x')).toBe('-0044-03-15 x')
    expect(formatInstant(bce, '[YYYY]')).toBe('YYYY')
    expect(formatInstant(bce, 'YYYY [unterminated')).toBe('-0044 unterminated')
    expect(formatInstant(iso('+012345-01-01T00:00:00Z'), 'YYYY')).toBe('+012345')
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

  it('formats instants before 1970 and before 1972', () => {
    expect(formatIso(instantFromTaiNanos(0n))).toBe('1969-12-31T23:59:50.000Z')
  })
})
