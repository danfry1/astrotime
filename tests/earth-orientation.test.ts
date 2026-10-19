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
  instantToTaiNanos,
  isAstrotimeError,
  type LeapSecondTable,
  parseIersFinals,
  parseInstantOrThrow,
  unwrap,
  validateLeapSecondTable,
} from '../src/index.js'
import reference from './fixtures/earth-orientation.json' with { type: 'json' }

const excerpt = readFileSync(new URL('fixtures/finals2000A-excerpt.txt', import.meta.url), 'utf8')
/**
 * Parsed inside each test rather than at module load, so mutation testing can
 * attribute parser mutants to the tests that observe them.
 */
const parsed = () => unwrap(parseIersFinals(excerpt))
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
    const table = parsed()
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

describe('Earth-orientation parsing and validation edge cases', () => {
  it('checks the year, month and day columns and the MJD field individually', () => {
    const row = lines[6]! // 16 12 1 … MJD 57723
    const reason = (text: string) => {
      const result = parseIersFinals([lines[5], text].join('\n'))
      return !result.ok && result.error.reason
    }
    expect(reason(`17${row.slice(2)}`)).toBe('date columns disagree with MJD 57723')
    expect(reason(`${row.slice(0, 2)}11${row.slice(4)}`)).toBe(
      'date columns disagree with MJD 57723',
    )
    expect(reason(`${row.slice(0, 4)} 2${row.slice(6)}`)).toBe(
      'date columns disagree with MJD 57723',
    )
    expect(reason(`${row.slice(0, 7)}${' '.repeat(8)}${row.slice(15)}`)).toBe(
      'MJD (columns 8–15) must be a whole day',
    )
  })

  it('rejects a malformed field in either bulletin, and lets Bulletin B decide finality', () => {
    const row = lines[6]!
    const reason = (text: string) => {
      const result = parseIersFinals([lines[5], text].join('\n'))
      return !result.ok && result.error.reason
    }
    const field = 'malformed UT1 − UTC or polar-motion field'
    expect(reason(`${row.slice(0, 154)}  -0.36x722${row.slice(165)}`)).toBe(field) // B UT1 − UTC
    expect(reason(`${row.slice(0, 144)}  0.3x0000${row.slice(154)}`)).toBe(field) // B PM-y
    expect(reason(`${row.slice(0, 37)} 0.3x0000${row.slice(46)}`)).toBe(field) // A PM-y
    // A Bulletin A prediction flag with a Bulletin B value is a final value.
    const flaggedP = `${row.slice(0, 57)}P${row.slice(58)}`
    expect(unwrap(parseIersFinals([lines[5], flaggedP].join('\n'))).entries[1]?.predicted).toBe(
      false,
    )
  })

  it('applies the line limit at exactly 200 000 lines', () => {
    const atLimit = parseIersFinals('\n'.repeat(199_999))
    expect(!atLimit.ok && atLimit.error.reason).toBe('a table needs at least two entries')
  })

  it('rejects UT1 − UTC of exactly one second and a missing table, with their reasons', () => {
    const instant = parseInstantOrThrow('2026-10-18T12:00:00Z')
    const row = { mjd: 61_331, ut1MinusUtc: 0, xp: 0, yp: 0, predicted: false }
    const message = (entries: unknown) => {
      try {
        earthOrientationAt(instant, { entries } as Parameters<typeof earthOrientationAt>[1])
        return 'accepted'
      } catch (error) {
        return (error as Error).message
      }
    }
    const prefix = 'Invalid Earth-orientation table: '
    expect(message([row, { ...row, mjd: 61_332, ut1MinusUtc: 1 }])).toBe(
      `${prefix}ut1MinusUtc must be finite and within (−1, 1) seconds`,
    )
    expect(message([row, { ...row, mjd: 61_332, yp: Number.NaN }])).toBe(
      `${prefix}polar motion must be finite`,
    )
    expect(message([row, { ...row, mjd: 61_332, predicted: 1 }])).toBe(
      `${prefix}predicted must be a boolean`,
    )
    expect(message([row])).toBe(`${prefix}a table needs at least two entries`)
    expect(() =>
      earthOrientationAt(instant, null as unknown as Parameters<typeof earthOrientationAt>[1]),
    ).toThrow(`${prefix}a table needs at least two entries`)
  })

  it('skips blank lines, accepts CRLF, and numbers errors by file line', () => {
    const crlf = parseIersFinals([lines[0], '', '   ', lines[1]].join('\r\n'))
    expect(unwrap(crlf).entries.map((entry) => entry.mjd)).toEqual([51_541, 51_542])
    const flag = `${lines[1]!.slice(0, 57)}X${lines[1]!.slice(58)}`
    const late = parseIersFinals([lines[0], '', flag].join('\n'))
    expect(!late.ok && late.error.line).toBe(3)
    const noUt1 = `${lines[1]!.slice(0, 58)}${' '.repeat(10)}${lines[1]!.slice(68)}`
    const resumed = parseIersFinals([lines[0], noUt1, lines[2]].join('\n'))
    expect(!resumed.ok && resumed.error.line).toBe(3)
    const huge = parseIersFinals('\n'.repeat(200_001))
    expect(!huge.ok && huge.error.line).toBe(200_001)
  })

  it('rejects duplicate days and caches only fully frozen tables', () => {
    const instant = parseInstantOrThrow('2026-10-18T12:00:00Z')
    const row = { mjd: 61_331, ut1MinusUtc: -0.04, xp: 0.1, yp: 0.3, predicted: false }
    expect(() => earthOrientationAt(instant, { entries: [row, { ...row }] })).toThrow(
      new RangeError(
        'Invalid Earth-orientation table: mjd must be safe integers in strictly ascending order',
      ),
    )
    // A frozen table whose entries array is still mutable is revalidated on
    // every call, so a later edit cannot ride on an earlier validation.
    const entries = [row, { ...row, mjd: 61_332 }]
    const halfFrozen = Object.freeze({ entries })
    expect(earthOrientationAt(instant, halfFrozen).ok).toBe(true)
    entries.push({ ...row, mjd: 61_332 })
    expect(() => earthOrientationAt(instant, halfFrozen)).toThrow(RangeError)
    expect(() =>
      earthOrientationAt(instant, { entries: [row, 'x' as unknown as typeof row] }),
    ).toThrow('Invalid Earth-orientation table: entries must be objects')
    expect(() => earthOrientationAt(instant, parsed(), null as unknown as object)).toThrow(
      'earthOrientationAt options must be an object',
    )
  })

  it('places rows on the TAI axis with the supplied leap-second table', () => {
    // Bundled table plus a hypothetical leap second at 2028-01-01 (MJD 61771).
    const table2028: LeapSecondTable = unwrap(
      validateLeapSecondTable({
        entries: [...IERS_LEAP_SECONDS.entries, { unixSeconds: 1_830_297_600, deltaAt: 38 }],
        expires: null,
      }),
    )
    // UT1 − UTC jumps by +1 s across that leap, as real data would; UT1 − TAI
    // is then constant at −37.4 s (−0.4 − 37 = 0.6 − 38), but only on the table
    // that has the leap.
    const day = (mjd: number, ut1MinusUtc: number) => ({
      mjd,
      ut1MinusUtc,
      xp: 0,
      yp: 0,
      predicted: true,
    })
    const eop = {
      entries: [day(61_769, -0.4), day(61_770, -0.4), day(61_771, 0.6), day(61_772, 0.6)],
    }
    const instant = parseInstantOrThrow('2028-01-01T12:00:00 TAI')
    const withLeap = unwrap(earthOrientationAt(instant, eop, { leapSeconds: table2028 }))
    expect(withLeap.ut1MinusTai).toBeCloseTo(-37.4, 9)
    expect(withLeap.ut1MinusUtc).toBeCloseTo(0.6, 9)
    const without = unwrap(earthOrientationAt(instant, eop))
    expect(Math.abs(without.ut1MinusTai - withLeap.ut1MinusTai)).toBeGreaterThan(0.1)
  })
})

describe('UT1, Earth rotation angle and sidereal time', () => {
  it('matches astropy (linear) and ERFA era00/gmst06 within 1e-13', () => {
    const table = parsed()
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
    const table = parsed()
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
    const table = parsed()
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
    const table = parsed()
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

  it('flags a result as predicted when any contributing row is, not only when all are', () => {
    const table = parsed()
    const first = table.entries.findIndex((entry) => entry.predicted)
    const noonAfter = (index: number) => {
      const entry = table.entries[index]
      if (entry === undefined) throw new Error(`no row ${String(index)}`)
      return instantFromTaiNanos(
        instantToTaiNanos(parseInstantOrThrow('1970-01-01T12:00:00Z')) +
          BigInt(entry.mjd - 40_587) * 86_400_000_000_000n,
      )
    }
    // Linear at noon after the last observed row mixes it with the first prediction.
    const mixed = unwrap(
      earthOrientationAt(noonAfter(first - 1), table, { interpolation: 'linear' }),
    )
    expect(mixed.predicted).toBe(true)
    const observed = unwrap(
      earthOrientationAt(noonAfter(first - 2), table, { interpolation: 'linear' }),
    )
    expect(observed.predicted).toBe(false)
    // Lagrange reaches one row further on each side.
    expect(unwrap(earthOrientationAt(noonAfter(first - 2), table)).predicted).toBe(true)
    expect(unwrap(earthOrientationAt(noonAfter(first - 3), table)).predicted).toBe(false)
  })

  it('keeps every sidereal angle in [0, 2π), before J2000 as after', () => {
    const table = parsed()
    for (const text of ['1999-12-29T00:00:00Z', '2000-01-01T00:00:00Z', '2026-10-01T18:00:00Z']) {
      const instant = parseInstantOrThrow(text)
      for (const angle of [
        unwrap(earthRotationAngle(instant, table)),
        unwrap(greenwichMeanSiderealTime(instant, table)),
        unwrap(greenwichApparentSiderealTime(instant, table)),
      ]) {
        expect(angle >= 0 && angle < 2 * Math.PI).toBe(true)
      }
    }
    const outside = earthOrientationAt(parseInstantOrThrow('1990-01-01T00:00:00Z'), table)
    expect(!outside.ok && outside.error.message).toBe(
      'Earth orientation unavailable: the instant is outside the table, which covers MJD 51541–61374 (UTC)',
    )
  })

  it('flags interpolation that uses predicted values', () => {
    const table = parsed()
    expect(
      unwrap(earthOrientationAt(parseInstantOrThrow('2016-12-15T00:00:00Z'), table)).predicted,
    ).toBe(false)
    expect(
      unwrap(earthOrientationAt(parseInstantOrThrow('2026-11-20T00:00:00Z'), table)).predicted,
    ).toBe(true)
  })

  it('gives a two-part UT1 Julian date consistent with the rotation angle', () => {
    const table = parsed()
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
    const table = parsed()
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
    const table = parsed()
    const outside = parseInstantOrThrow('1990-01-01T00:00:00Z')
    expect(instantToUt1JulianDateParts(outside, table).ok).toBe(false)
    expect(earthRotationAngle(outside, table).ok).toBe(false)
    expect(greenwichMeanSiderealTime(outside, table).ok).toBe(false)
    expect(greenwichApparentSiderealTime(outside, table).ok).toBe(false)
  })

  it('rejects malformed hand-built tables and options as programmer errors', () => {
    const table = parsed()
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
