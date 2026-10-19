import { describe, expect, it } from 'vitest'

import {
  formatIso,
  instantFromScaleNanos,
  instantFromTaiNanos,
  instantToScaleNanos,
  instantToTaiNanos,
  type Observer,
  parseInstantOrThrow,
} from '../src/index.js'
import { topocentricFrom, topocentricTdbMinusTt } from '../src/observer.js'
import reference from './fixtures/astropy-topocentric.json' with { type: 'json' }

type Site = { longitudeDeg: number; latitudeDeg: number; heightM: number; uKm: number; vKm: number }
type Row = {
  observer: string
  taiNanos: string
  tdb: string
  tcb: string
  utcDayFraction: number
  topocentricSeconds: number
}

const observers = reference.observers as Record<string, Site>
const rows = reference.rows as Row[]
const DEGREE = Math.PI / 180
const observerOf = (name: string): Observer => {
  const site = observers[name]
  if (site === undefined) throw new Error(`no observer named ${name} in the fixture`)
  return {
    longitude: site.longitudeDeg * DEGREE,
    latitude: site.latitudeDeg * DEGREE,
    height: site.heightM,
  }
}
const goldstone = observerOf('Goldstone DSS-14')

describe('topocentric TDB and TCB', () => {
  it('agrees with astropy (Time with a location) within one nanosecond', () => {
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      const observer = observerOf(row.observer)
      for (const [scale, label, expected] of [
        ['tdb', 'TDB', row.tdb],
        ['tcb', 'TCB', row.tcb],
      ] as const) {
        const ours = formatIso(instant, { scale, precision: 'nanos', designator: 'none', observer })
        const difference =
          instantToTaiNanos(parseInstantOrThrow(`${ours} ${label}`)) -
          instantToTaiNanos(parseInstantOrThrow(`${expected} ${label}`))
        expect(difference >= -1n && difference <= 1n).toBe(true)
      }
    }
    expect(rows).toHaveLength(246)
  })

  it('moves a surface station by up to about 2 µs, and nothing when omitted', () => {
    let largest = 0n
    for (const row of rows) {
      const instant = instantFromTaiNanos(BigInt(row.taiNanos))
      const shift =
        instantToScaleNanos(instant, 'tdb', { observer: observerOf(row.observer) }) -
        instantToScaleNanos(instant, 'tdb')
      const size = shift < 0n ? -shift : shift
      if (size > largest) largest = size
      expect(instantToScaleNanos(instant, 'tdb', { observer: undefined })).toBe(
        instantToScaleNanos(instant, 'tdb'),
      )
      // Uniform scales and UTC are not affected by where they are read.
      expect(instantToScaleNanos(instant, 'tt', { observer: goldstone })).toBe(
        instantToScaleNanos(instant, 'tt'),
      )
    }
    expect(largest > 1_500n && largest < 2_500n).toBe(true)
  })

  it('round-trips TCB exactly and TDB within a nanosecond for an observer', () => {
    for (const row of rows) {
      const tai = BigInt(row.taiNanos)
      const options = { observer: observerOf(row.observer) }
      const instant = instantFromTaiNanos(tai)
      const tcb = instantFromScaleNanos(
        instantToScaleNanos(instant, 'tcb', options),
        'tcb',
        options,
      )
      expect(instantToTaiNanos(tcb)).toBe(tai)
      const tdb = instantFromScaleNanos(
        instantToScaleNanos(instant, 'tdb', options),
        'tdb',
        options,
      )
      const error = instantToTaiNanos(tdb) - tai
      expect(error >= -1n && error <= 1n).toBe(true)
    }
  })

  it('places observers as ERFA gd2gc does and reproduces the dtdb topocentric terms to 1e-16 s', () => {
    // Checked in seconds rather than through nanosecond readings, so terms
    // far below a nanosecond (the smallest is ~2e-13 s) are verified too.
    for (const [name, site] of Object.entries(observers)) {
      const topo = topocentricFrom(observerOf(name))
      expect(Math.abs((topo?.u ?? 0) - site.uKm)).toBeLessThan(1e-9)
      expect(Math.abs((topo?.v ?? 0) - site.vKm)).toBeLessThan(1e-9)
    }
    for (const row of rows) {
      const topo = topocentricFrom(observerOf(row.observer))
      if (topo === null) throw new Error('observer expected')
      const ttDays =
        Number(BigInt(row.taiNanos) + 32_184_000_000n - 946_728_000_000_000_000n) / 86_400e9
      const ours = topocentricTdbMinusTt(topo, ttDays / 365_250, row.utcDayFraction)
      expect(Math.abs(ours - row.topocentricSeconds)).toBeLessThan(1e-16)
    }
  })

  it('accepts heights up to exactly ±100 km', () => {
    const instant = parseInstantOrThrow('2026-10-19T12:00:00Z')
    for (const height of [100_000, -100_000]) {
      expect(() =>
        instantToScaleNanos(instant, 'tdb', { observer: { longitude: 0, latitude: 0, height } }),
      ).not.toThrow()
    }
  })

  it('rejects a malformed or non-terrestrial observer instead of reading geocentric TDB', () => {
    const instant = parseInstantOrThrow('2026-10-19T12:00:00Z')
    for (const observer of [
      null,
      { longitude: 0, latitude: 0 },
      { longitude: Number.NaN, latitude: 0, height: 0 },
      { longitude: 0, latitude: 2, height: 0 },
      { longitude: 0, latitude: 0, height: 400_000 },
    ]) {
      expect(() =>
        instantToScaleNanos(instant, 'tdb', { observer: observer as unknown as Observer }),
      ).toThrow(RangeError)
    }
    expect(() =>
      instantToScaleNanos(instant, 'tdb', { observer: { longitude: 0, latitude: 0, height: 4e5 } }),
    ).toThrow(
      'observer height must be within ±100 km of the ellipsoid (an Earth-fixed observer), got 400000 m',
    )
    expect(() =>
      instantToScaleNanos(instant, 'tdb', { observer: null as unknown as Observer }),
    ).toThrow('observer must be { longitude, latitude, height } with finite numbers')
    expect(() =>
      instantToScaleNanos(instant, 'tdb', { observer: { longitude: 0, latitude: 2, height: 0 } }),
    ).toThrow('observer latitude must be within ±π/2 radians, got 2')
  })
})
