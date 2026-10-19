import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  EarthOrientationError,
  earthOrientationAt,
  earthRotationAngle,
  greenwichApparentSiderealTime,
  greenwichMeanSiderealTime,
  IERS_LEAP_SECONDS,
  instantFromTaiNanos,
  instantToUt1JulianDateParts,
  isAstrotimeError,
  parseIersFinals,
  parseInstantOrThrow,
  unwrap,
} from '../src/index.js'
import reference from './fixtures/earth-orientation.json' with { type: 'json' }

const excerpt = readFileSync(new URL('fixtures/finals2000A-excerpt.txt', import.meta.url), 'utf8')
const table = unwrap(parseIersFinals(excerpt))
const lines = excerpt.split('\n')

type Values = {
  ut1MinusUtc?: number
  ut1MinusTai?: number
  xp: number
  yp: number
  era: number
  gmst: number
  gast: number
}
type Row = { taiNanos: string; linear: Values; lagrange: Values }
const rows = reference.rows as Row[]

/** astropy, ERFA and the independent Lagrange reference all agree to ~4e-14. */
const TOLERANCE = 1e-13
const angleError = (a: number, b: number): number => {
  const difference = a - b
  return Math.abs(difference - Math.round(difference / (2 * Math.PI)) * 2 * Math.PI)
}

describe('IERS finals2000A parsing', () => {
  it('reads Bulletin B where present and Bulletin A with its prediction flag otherwise', () => {
    expect(table.entries).toHaveLength(159)
    // 2016-12-01 (line 7): Bulletin B UT1 − UTC −0.3697225 s replaces Bulletin A −0.3697018 s.
    const row = lines[6]!
    expect(Number(row.slice(58, 68))).toBe(-0.3697018)
    expect(table.entries[6]).toEqual({
      mjd: 57_723,
      ut1MinusUtc: -0.3697225,
      xp: Number(row.slice(134, 144)),
      yp: Number(row.slice(144, 154)),
      predicted: false,
    })
    // Two-digit years: '99' is 1999 up to MJD 51543, ' 0' is 2000 from MJD 51544.
    expect(table.entries.slice(0, 6).map((entry) => entry.mjd)).toEqual([
      51_541, 51_542, 51_543, 51_544, 51_545, 51_546,
    ])
    expect(table.entries.filter((entry) => entry.predicted)).toHaveLength(46)
    expect(table.entries.at(-1)?.predicted).toBe(true)
    expect(Object.isFrozen(table) && Object.isFrozen(table.entries)).toBe(true)
  })

  it('names the line of a malformed row', () => {
    const flag = `${lines[1]!.slice(0, 57)}X${lines[1]!.slice(58)}`
    const result = parseIersFinals([lines[0], flag, lines[2]].join('\n'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(EarthOrientationError)
    expect(isAstrotimeError(result.error)).toBe(true)
    expect(result.error.toJSON()).toEqual({
      name: 'EarthOrientationError',
      code: 'EARTH_ORIENTATION',
      message:
        'Invalid Earth-orientation data at line 2: UT1 − UTC flag (column 58) must be I or P',
      line: 2,
      reason: 'UT1 − UTC flag (column 58) must be I or P',
    })
  })

  it('rejects malformed MJD and numeric fields, and oversized input', () => {
    const fractionalMjd = `${lines[1]!.slice(0, 7)}51542.50${lines[1]!.slice(15)}`
    const mjd = parseIersFinals([lines[0], fractionalMjd].join('\n'))
    expect(!mjd.ok && mjd.error.reason).toBe('MJD (columns 8–15) must be a whole day')
    const badX = `${lines[1]!.slice(0, 18)}  0.04x63${lines[1]!.slice(27)}`
    const field = parseIersFinals([lines[0], badX].join('\n'))
    expect(!field.ok && field.error.reason).toBe('malformed UT1 − UTC or polar-motion field')
    const line = lines[1]!
    const noPolarMotion = `${line.slice(0, 18)}${' '.repeat(9)}${line.slice(27, 134)}${' '.repeat(10)}${line.slice(144)}`
    const missing = parseIersFinals([lines[0], noPolarMotion].join('\n'))
    expect(!missing.ok && missing.error.reason).toBe('malformed UT1 − UTC or polar-motion field')
    const huge = parseIersFinals('\n'.repeat(200_001))
    expect(!huge.ok && huge.error.reason).toBe('file exceeds the line limit')
  })

  it('rejects date columns that disagree with the MJD, gaps in UT1, and tiny tables', () => {
    const wrongDay = `${lines[0]!.slice(0, 4)}02${lines[0]!.slice(6)}`
    expect(parseIersFinals(wrongDay).ok).toBe(false)
    const noUt1 = `${lines[1]!.slice(0, 58)}${' '.repeat(10)}${lines[1]!.slice(68)}`
    const resumed = parseIersFinals([lines[0], noUt1, lines[2]].join('\n'))
    expect(!resumed.ok && resumed.error.reason).toBe('UT1 − UTC resumes after a row without it')
    expect(parseIersFinals(lines[0] ?? '').ok).toBe(false)
    expect(parseIersFinals([lines[1], lines[0]].join('\n')).ok).toBe(false)
    // Trailing rows past the predictions (no UT1 − UTC) end the table.
    expect(unwrap(parseIersFinals([lines[0], lines[1], noUt1].join('\n'))).entries).toHaveLength(2)
  })
})

describe('UT1, Earth rotation angle and sidereal time', () => {
  it('matches astropy (linear) and ERFA era00/gmst06 within 1e-13', () => {
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      const options = { interpolation: 'linear' } as const
      const orientation = unwrap(earthOrientationAt(instant, table, options))
      expect(Math.abs(orientation.ut1MinusUtc - row.linear.ut1MinusUtc!)).toBeLessThan(TOLERANCE)
      expect(Math.abs(orientation.xp - row.linear.xp)).toBeLessThan(TOLERANCE)
      expect(Math.abs(orientation.yp - row.linear.yp)).toBeLessThan(TOLERANCE)
      const era = unwrap(earthRotationAngle(instant, table, options))
      expect(angleError(era, row.linear.era)).toBeLessThan(TOLERANCE)
      const gmst = unwrap(greenwichMeanSiderealTime(instant, table, options))
      expect(angleError(gmst, row.linear.gmst)).toBeLessThan(TOLERANCE)
    }
    expect(rows).toHaveLength(127)
  })

  it('matches an independent four-point Lagrange reference within 1e-13', () => {
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      const orientation = unwrap(earthOrientationAt(instant, table))
      expect(Math.abs(orientation.ut1MinusTai - row.lagrange.ut1MinusTai!)).toBeLessThan(TOLERANCE)
      expect(Math.abs(orientation.xp - row.lagrange.xp)).toBeLessThan(TOLERANCE)
      expect(Math.abs(orientation.yp - row.lagrange.yp)).toBeLessThan(TOLERANCE)
      expect(angleError(unwrap(earthRotationAngle(instant, table)), row.lagrange.era)).toBeLessThan(
        TOLERANCE,
      )
      expect(
        angleError(unwrap(greenwichMeanSiderealTime(instant, table)), row.lagrange.gmst),
      ).toBeLessThan(TOLERANCE)
    }
  })

  it('matches ERFA gst06a apparent sidereal time within 2e-11 rad on both interpolations', () => {
    // gst06a goes through the full IAU 2006/2000A precession-nutation matrix;
    // astrotime adds the equation of the equinoxes to GMST (≤ 3.1 µas apart
    // over 1800–2200, 1.3e-12 rad on these dates).
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      for (const interpolation of ['linear', 'lagrange'] as const) {
        const gast = unwrap(greenwichApparentSiderealTime(instant, table, { interpolation }))
        expect(angleError(gast, row[interpolation].gast)).toBeLessThan(2e-11)
        expect(gast >= 0 && gast < 2 * Math.PI).toBe(true)
      }
    }
  })

  it('keeps UT1 continuous through a leap second while UT1 − UTC jumps by one second', () => {
    const at = (text: string) => unwrap(earthOrientationAt(parseInstantOrThrow(text), table))
    const before = at('2016-12-31T23:59:59.5Z')
    const leap = at('2016-12-31T23:59:60.5Z')
    const after = at('2017-01-01T00:00:00.5Z')
    expect(after.ut1MinusUtc - before.ut1MinusUtc).toBeCloseTo(1, 6)
    expect(leap.ut1MinusUtc).toBeCloseTo(before.ut1MinusUtc, 6)
    expect(Math.abs(after.ut1MinusTai - before.ut1MinusTai)).toBeLessThan(1e-6)
    const era = (text: string) => unwrap(earthRotationAngle(parseInstantOrThrow(text), table))
    // One SI second turns the Earth by ~7.29e-5 rad, leap or not.
    expect(era('2016-12-31T23:59:60.5Z') - era('2016-12-31T23:59:59.5Z')).toBeCloseTo(7.2921e-5, 8)
    expect(era('2017-01-01T00:00:00.5Z') - era('2016-12-31T23:59:60.5Z')).toBeCloseTo(7.2921e-5, 8)
  })

  it('flags interpolation that uses predicted values', () => {
    expect(
      unwrap(earthOrientationAt(parseInstantOrThrow('2016-12-15T00:00:00Z'), table)).predicted,
    ).toBe(false)
    expect(
      unwrap(earthOrientationAt(parseInstantOrThrow('2026-11-20T00:00:00Z'), table)).predicted,
    ).toBe(true)
  })

  it('gives a two-part UT1 Julian date consistent with the rotation angle', () => {
    const instant = parseInstantOrThrow('2026-10-19T12:34:56.789Z')
    const { jd1, jd2 } = unwrap(instantToUt1JulianDateParts(instant, table))
    expect(jd1 % 1).toBe(0.5)
    expect(jd2 >= 0 && jd2 < 1).toBe(true)
    const tu = jd1 - 2_451_545 + jd2
    const turns = (0.779_057_273_264 + 0.002_737_811_911_354_48 * tu + (jd1 % 1) + jd2) % 1
    expect(
      angleError(unwrap(earthRotationAngle(instant, table)), turns * 2 * Math.PI),
    ).toBeLessThan(1e-9)
  })

  it('refuses instants outside the table or inside a gap, to the nanosecond', () => {
    const at = (text: string) => earthOrientationAt(parseInstantOrThrow(text), table)
    expect(at('2016-12-01T00:00:00Z').ok).toBe(true)
    expect(at('2016-11-30T23:59:59.999999999Z').ok).toBe(false)
    expect(at('2026-11-30T00:00:00Z').ok).toBe(true)
    expect(at('2026-11-30T00:00:00.000000001Z').ok).toBe(false)
    expect(at('2017-01-31T00:00:00Z').ok).toBe(true)
    const gap = at('2020-06-01T00:00:00Z')
    expect(!gap.ok && gap.error.reason).toBe(
      'the table has no rows between MJD 57784 and 61284; EOP values are not interpolated across a gap',
    )
    expect(!gap.ok && gap.error.line).toBe(null)
    expect(earthRotationAngle(parseInstantOrThrow('2020-06-01T00:00:00Z'), table).ok).toBe(false)
  })

  it('accepts a valid hand-built table and an explicit leap-second table', () => {
    const entries = [
      { mjd: 61_331, ut1MinusUtc: -0.04, xp: 0.1, yp: 0.3, predicted: false },
      { mjd: 61_332, ut1MinusUtc: -0.05, xp: 0.2, yp: 0.4, predicted: false },
    ]
    const noon = parseInstantOrThrow('2026-10-18T12:00:00Z')
    const orientation = unwrap(
      earthOrientationAt(noon, { entries }, { leapSeconds: IERS_LEAP_SECONDS }),
    )
    expect(orientation.ut1MinusUtc).toBeCloseTo(-0.045, 12)
    expect(orientation.xp).toBeCloseTo(0.15, 12)
    expect(orientation.ut1MinusTai).toBeCloseTo(-37.045, 12)
  })

  it('propagates coverage errors from every derived quantity', () => {
    const outside = parseInstantOrThrow('1990-01-01T00:00:00Z')
    expect(instantToUt1JulianDateParts(outside, table).ok).toBe(false)
    expect(earthRotationAngle(outside, table).ok).toBe(false)
    expect(greenwichMeanSiderealTime(outside, table).ok).toBe(false)
    expect(greenwichApparentSiderealTime(outside, table).ok).toBe(false)
  })

  it('rejects malformed hand-built tables and options as programmer errors', () => {
    const instant = parseInstantOrThrow('2026-10-19T00:00:00Z')
    const entry = { mjd: 61_332, ut1MinusUtc: 0, xp: 0, yp: 0, predicted: false }
    expect(() => earthOrientationAt(instant, { entries: [entry] })).toThrow(RangeError)
    expect(() =>
      earthOrientationAt(instant, { entries: [entry, { ...entry, ut1MinusUtc: 1.5 }] }),
    ).toThrow(RangeError)
    for (const bad of [
      { ...entry, mjd: 61_333, ut1MinusUtc: Number.NaN },
      { ...entry, mjd: 61_333, xp: Number.POSITIVE_INFINITY },
      { ...entry, mjd: 61_333, predicted: 'no' as unknown as boolean },
      null as unknown as typeof entry,
    ]) {
      expect(() => earthOrientationAt(instant, { entries: [entry, bad] })).toThrow(RangeError)
    }
    expect(() =>
      earthOrientationAt(instant, table, { interpolation: 'cubic' as 'linear' }),
    ).toThrow(new RangeError('interpolation must be "lagrange" or "linear", got "cubic"'))
    expect(() =>
      earthOrientationAt(instant, table, { interpolation: Symbol('x') as unknown as 'linear' }),
    ).toThrow(new RangeError('interpolation must be "lagrange" or "linear", got symbol'))
  })
})
