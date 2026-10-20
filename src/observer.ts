import { deterministicCos, deterministicSin } from './numeric.js'

/** A place on the Earth, as WGS84 geodetic coordinates. */
export type Observer = {
  /** East longitude, radians. */
  readonly longitude: number
  /** Geodetic latitude, radians in [−π/2, π/2]. */
  readonly latitude: number
  /** Height above the WGS84 ellipsoid, metres (within ±100 km: an Earth-fixed observer). */
  readonly height: number
}

/** The observer as ERFA `dtdb` takes it: longitude (rad) and u, v (km). */
export type Topocentric = {
  readonly longitude: number
  /** Distance from the Earth's spin axis, km. */
  readonly u: number
  /** Distance north of the equatorial plane, km. */
  readonly v: number
}

const WGS84_A = 6_378_137
const WGS84_F = 1 / 298.257_223_563
/** The topocentric model is for observers fixed to the Earth's surface. */
const MAX_ABS_HEIGHT_METRES = 100_000

/**
 * Validates `observer` (`undefined` means geocentric) and converts it to
 * `dtdb` form, as ERFA `gd2gce` does for the WGS84 ellipsoid. Throws
 * `RangeError` for anything else: a malformed observer is a programmer error,
 * and silently ignoring it would report a geocentric reading as topocentric.
 */
export function topocentricFrom(observer: unknown): Topocentric | null {
  if (observer === undefined) return null
  // A null, primitive or incomplete observer yields a non-finite field.
  const { longitude, latitude, height } = (observer ?? {}) as Partial<Observer>
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(height)) {
    throw new RangeError('observer must be { longitude, latitude, height } with finite numbers')
  }
  const lat = latitude as number
  if (Math.abs(lat) > Math.PI / 2) {
    throw new RangeError(`observer latitude must be within ±π/2 radians, got ${String(lat)}`)
  }
  const h = height as number
  if (Math.abs(h) > MAX_ABS_HEIGHT_METRES) {
    throw new RangeError(
      `observer height must be within ±100 km of the ellipsoid (an Earth-fixed observer), got ${String(h)} m`,
    )
  }
  const sp = deterministicSin(lat)
  const cp = deterministicCos(lat)
  const w = (1 - WGS84_F) * (1 - WGS84_F)
  const ac = WGS84_A / Math.sqrt(cp * cp + w * sp * sp)
  return {
    longitude: longitude as number,
    u: ((ac + h) * cp) / 1000,
    v: ((w * ac + h) * sp) / 1000,
  }
}

const DD2R = Math.PI / 180

/**
 * The topocentric part of TDB − TT in seconds (ERFA `dtdb`, Moyer 1981 and
 * Murray 1983): the observer's diurnal motion and position relative to the
 * geocentre, up to ~2 µs. `t` is Julian millennia of TT since J2000 and `ut`
 * the fraction of the UTC day in [0, 1) (UT1 in principle; < 1e-10 s
 * difference), so ERFA's fmod(ut, 1) is not needed.
 */
export function topocentricTdbMinusTt(topo: Topocentric, t: number, ut: number): number {
  const { u, v } = topo
  const tsol = ut * 2 * Math.PI + topo.longitude
  const w = t / 3600
  const elsun = ((280.466_456_83 + 1_296_027_711.034_29 * w) % 360) * DD2R
  const emsun = ((357.529_109_18 + 1_295_965_810.481 * w) % 360) * DD2R
  const d = ((297.850_195_47 + 16_029_616_012.09 * w) % 360) * DD2R
  const elj = ((34.351_518_74 + 109_306_899.894_53 * w) % 360) * DD2R
  const els = ((50.077_444_3 + 44_046_398.470_38 * w) % 360) * DD2R
  const s = deterministicSin
  return (
    0.000_29e-10 * u * s(tsol + elsun - els) +
    0.001e-10 * u * s(tsol - 2 * emsun) +
    0.001_33e-10 * u * s(tsol - d) +
    0.001_33e-10 * u * s(tsol + elsun - elj) -
    0.002_29e-10 * u * s(tsol + 2 * elsun + emsun) -
    0.022e-10 * v * deterministicCos(elsun + emsun) +
    0.053_12e-10 * u * s(tsol - emsun) -
    0.136_77e-10 * u * s(tsol + 2 * elsun) -
    1.318_4e-10 * v * deterministicCos(elsun) +
    3.176_79e-10 * u * s(tsol)
  )
}
