import { describe, expect, it } from 'vitest'

import {
  civilToInstant,
  formatIso,
  gpsWeek,
  instantFromGpsSeconds,
  instantFromGpsWeek,
  instantFromJulianDate,
  instantFromJulianDateParts,
  instantFromModifiedJulianDate,
  instantFromNanosSinceJ2000,
  instantFromScaleNanos,
  instantFromSecondsSinceJ2000,
  instantsEqual,
  instantToCivil,
  J2000_INSTANT,
  julianDate,
  julianDateParts,
  modifiedJulianDate,
  nanosSinceJ2000,
  parseInstant,
  scaleNanos,
  secondsSinceJ2000,
  TIME_SCALES,
  type TimeScale,
  unwrap,
} from '../src/index.js'

const iso = (text: string) => unwrap(parseInstant(text))

describe('J2000', () => {
  it('is 2000-01-01T12:00:00 TT = 11:58:55.816 UTC', () => {
    expect(formatIso(J2000_INSTANT, { scale: 'tt' })).toBe('2000-01-01T12:00:00.000')
    expect(formatIso(J2000_INSTANT)).toBe('2000-01-01T11:58:55.816Z')
    expect(secondsSinceJ2000(J2000_INSTANT)).toBe(0)
    expect(nanosSinceJ2000(J2000_INSTANT, 'tdb')).toBe(0n)
  })

  it('counts seconds on each scale', () => {
    const later = iso('2000-01-02T11:58:55.816Z')
    expect(secondsSinceJ2000(later, 'tt')).toBe(86_400)
    expect(secondsSinceJ2000(later, 'tai')).toBe(86_400)
    expect(secondsSinceJ2000(later, 'utc')).toBe(86_400)
    expect(secondsSinceJ2000(later, 'gps')).toBe(86_400)
  })

  it('round-trips through every scale', () => {
    const i = iso('2026-08-19T12:34:56.789012345Z')
    for (const scale of TIME_SCALES) {
      expect(instantsEqual(instantFromNanosSinceJ2000(nanosSinceJ2000(i, scale), scale), i)).toBe(
        true,
      )
      expect(instantsEqual(instantFromScaleNanos(scaleNanos(i, scale), scale), i)).toBe(true)
    }
    expect(
      formatIso(instantFromSecondsSinceJ2000(0.5, 'tt'), { scale: 'tt', precision: 'auto' }),
    ).toBe('2000-01-01T12:00:00.500')
  })
})

describe('Julian dates', () => {
  it('JD 2451545.0 is J2000 on the TT scale', () => {
    expect(julianDate(J2000_INSTANT, 'tt')).toBe(2_451_545)
    expect(julianDateParts(J2000_INSTANT, 'tt')).toStrictEqual({ jd1: 2_451_544.5, jd2: 0.5 })
    expect(modifiedJulianDate(J2000_INSTANT, 'tt')).toBe(51_544.5)
  })

  it('JD 2440587.5 is the Unix epoch', () => {
    expect(julianDate(iso('1970-01-01T00:00:00Z'), 'utc')).toBe(2_440_587.5)
    expect(modifiedJulianDate(iso('1970-01-01T00:00:00Z'), 'utc')).toBe(40_587)
  })

  it('round-trips with two-part precision', () => {
    const i = iso('2026-08-19T12:34:56.789012345Z')
    const { jd1, jd2 } = julianDateParts(i, 'tai')
    const back = instantFromJulianDateParts(jd1, jd2, 'tai')
    expect(formatIso(back, { precision: 'nanos' })).toBe('2026-08-19T12:34:56.789012345Z')
    expect(formatIso(instantFromJulianDate(2_451_545, 'tt'), { scale: 'tt' })).toBe(
      '2000-01-01T12:00:00.000',
    )
    expect(formatIso(instantFromModifiedJulianDate(51_544.5, 'tt'), { scale: 'tt' })).toBe(
      '2000-01-01T12:00:00.000',
    )
  })
})

describe('GPS', () => {
  it('epoch 1980-01-06 is week 0, second 0', () => {
    expect(gpsWeek(iso('1980-01-06T00:00:00Z'))).toStrictEqual({ week: 0, secondsOfWeek: 0 })
    expect(formatIso(instantFromGpsWeek(0, 0))).toBe('1980-01-06T00:00:00.000Z')
  })

  it('counts leap seconds (GPS − UTC = 18 s since 2017)', () => {
    const i = iso('2026-08-19T00:00:00Z')
    expect(gpsWeek(i)).toStrictEqual({ week: 2432, secondsOfWeek: 259_218 })
    expect(instantsEqual(instantFromGpsWeek(2432, 259_218), i)).toBe(true)
    expect(instantsEqual(instantFromGpsSeconds(2432 * 604_800 + 259_218), i)).toBe(true)
  })
})

describe('civil time in uniform scales', () => {
  it('reads the TAI clock', () => {
    expect(instantToCivil(iso('2016-12-31T23:59:60.25Z'), 'tai')).toStrictEqual({
      year: 2017,
      month: 1,
      day: 1,
      dayOfYear: 1,
      hour: 0,
      minute: 0,
      second: 36,
      nanosecond: 250_000_000,
    })
  })

  it.each(TIME_SCALES)('round-trips civil fields on %s', (scale: TimeScale) => {
    const fields = {
      year: 2026,
      month: 8,
      day: 19,
      hour: 12,
      minute: 34,
      second: 56,
      nanosecond: 789,
    }
    const i = unwrap(civilToInstant(fields, scale))
    expect(instantToCivil(i, scale)).toStrictEqual({ ...fields, dayOfYear: 231 })
  })

  it('rejects second 60 on uniform scales and propagates field errors', () => {
    const leap = civilToInstant(
      { year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 },
      'gps',
    )
    expect(leap.ok).toBe(false)
    if (!leap.ok) expect(leap.error.reason).toBe('GPS has no leap seconds')
    const bad = civilToInstant({ year: 2016, month: 13, day: 1 }, 'tai')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.field).toBe('month')
  })
})

describe('TDB', () => {
  it('differs from TT by at most 1.7 ms and round-trips', () => {
    for (const month of [1, 4, 7, 10]) {
      const i = unwrap(civilToInstant({ year: 2026, month, day: 1 }, 'utc'))
      const diff = Number(scaleNanos(i, 'tdb') - scaleNanos(i, 'tt'))
      expect(Math.abs(diff)).toBeLessThanOrEqual(1_700_000)
      expect(instantsEqual(instantFromScaleNanos(scaleNanos(i, 'tdb'), 'tdb'), i)).toBe(true)
    }
  })
})
