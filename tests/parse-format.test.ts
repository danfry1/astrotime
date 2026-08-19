import { describe, expect, it } from 'vitest'

import {
  formatInstant,
  formatIso,
  formatOrdinal,
  InvalidTimeError,
  instantFromTaiNanos,
  isValidInstant,
  parseInstant,
  TimeParseError,
  unwrap,
} from '../src/index.js'

const iso = (text: string) => unwrap(parseInstant(text))

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
    ['+002026-08-19T12:34:56Z', '2026-08-19T12:34:56.000000000Z'],
    ['-0001-01-01T00:00:00Z', '-0001-01-01T00:00:00.000000000Z'],
    ['2016-12-31T23:59:60.5Z', '2016-12-31T23:59:60.500000000Z'],
  ])('parses %s', (text, expected) => {
    expect(formatIso(iso(text), { precision: 'nanos' })).toBe(expected)
  })

  it.each([
    ['2026-8-19', 'iso'],
    ['2026-08-19T12', 'iso'],
    ['2026-08-19T12:34:56.1234567890Z', 'iso'],
    ['20260819', 'iso'],
    ['', 'iso'],
    ['2026-08-19T12:34:56Z', 'ordinal'],
  ])('rejects %s under %s', (text, format) => {
    const result = parseInstant(text, { format })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeParseError)
      if (result.error instanceof TimeParseError) expect(result.error.format).toBe(format)
    }
  })

  it('reports invalid field values', () => {
    const result = parseInstant('2026-02-30T00:00:00Z')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvalidTimeError)
      expect(result.error.toJSON()).toStrictEqual({
        code: 'INVALID_TIME',
        field: 'day',
        value: 30,
        reason: 'must be between 1 and 28',
      })
    }
  })

  it('rejects leap seconds combined with a non-zero offset', () => {
    const result = parseInstant('2017-01-01T00:59:60+01:00')
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.error.message).toBe(
        'Invalid second 60: a leap second with a non-zero UTC offset is not supported',
      )
  })

  it('parses other scales and rejects UTC designators on them', () => {
    const tai = unwrap(parseInstant('2017-01-01T00:00:37', { scale: 'tai' }))
    expect(formatIso(tai)).toBe('2017-01-01T00:00:00.000Z')
    const bad = parseInstant('2017-01-01T00:00:37Z', { scale: 'tai' })
    expect(bad.ok).toBe(false)
    if (!bad.ok)
      expect(bad.error.reason).toBe('a UTC designator/offset is not valid for the TAI scale')
    const leap = parseInstant('2016-12-31T23:59:60', { scale: 'tt' })
    expect(leap.ok).toBe(false)
    if (!leap.ok) expect(leap.error.reason).toBe('TT has no leap seconds')
  })

  it('ordinal format accepts only day-of-year text', () => {
    expect(formatIso(unwrap(parseInstant('2026-231T12:00', { format: 'ordinal' })))).toBe(
      '2026-08-19T12:00:00.000Z',
    )
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
  ])('round-trips %s', (pattern, text, expectedIso) => {
    const instant = unwrap(parseInstant(text, { format: pattern }))
    expect(formatIso(instant)).toBe(expectedIso)
    expect(formatInstant(instant, pattern)).toBe(text)
  })

  it('is strict about widths and literals', () => {
    expect(isValidInstant('2026-08-19 12:34:56', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })).toBe(false)
    expect(isValidInstant('2026-08-19T12:34:56', { format: 'YYYY-MM-DD HH:mm:ss' })).toBe(false)
    expect(isValidInstant('2026-08-19 12:34:56.1234', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })).toBe(
      false,
    )
  })

  it('requires a year token', () => {
    const result = parseInstant('12:34:56', { format: 'HH:mm:ss' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('pattern must include a year (YYYY)')
  })

  it('formats negative years and unknown letters', () => {
    const bce = unwrap(parseInstant('-0044-03-15T00:00:00Z'))
    expect(formatInstant(bce, 'YYYY-MM-DD x')).toBe('-0044-03-15 x')
    expect(formatInstant(bce, '[YYYY]')).toBe('YYYY')
    expect(formatInstant(bce, 'YYYY [unterminated')).toBe('-0044 unterminated')
  })
})

describe('formatIso / formatOrdinal precision', () => {
  const i = unwrap(parseInstant('2026-08-19T12:34:56.789012000Z'))
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

  it('omits Z for non-UTC scales and formats ordinal dates', () => {
    expect(formatIso(i, { scale: 'gps', precision: 'seconds' })).toBe('2026-08-19T12:35:14')
    expect(formatOrdinal(i)).toBe('2026-231T12:34:56.789')
    expect(formatOrdinal(i, { scale: 'tt', precision: 'auto' })).toBe('2026-231T12:36:05.973012')
  })

  it('formats instants before 1970 and before 1972', () => {
    expect(formatIso(instantFromTaiNanos(0n))).toBe('1969-12-31T23:59:50.000Z')
  })
})
