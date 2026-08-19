import { assertNever } from './assert.js'
import { daysFromCivil } from './calendar.js'
import { NANOS_PER_DAY, NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError } from './errors.js'
import {
  civilFromUnixSeconds,
  type Instant,
  instantFromTaiNanos,
  instantFromUnixNanos,
  instantToUnixNanos,
  instantToUtc,
  resolveCivilFields,
  type UtcDateTime,
  type UtcFields,
  type UtcOptions,
  utcToInstant,
} from './instant.js'
import { err, ok, type Result } from './result.js'

/**
 * Supported time scales.
 * - `utc` — Coordinated Universal Time (leap seconds).
 * - `tai` — International Atomic Time (uniform).
 * - `tt`  — Terrestrial Time = TAI + 32.184 s.
 * - `gps` — GPS time = TAI − 19 s.
 * - `tdb` — Barycentric Dynamical Time ≈ TT + periodic term (≤ 1.7 ms; this
 *           implementation is accurate to ~20 µs).
 */
export type TimeScale = 'utc' | 'tai' | 'tt' | 'gps' | 'tdb'

export const TIME_SCALES = [
  'utc',
  'tai',
  'tt',
  'gps',
  'tdb',
] as const satisfies readonly TimeScale[]

export const TT_MINUS_TAI_NANOS = 32_184_000_000n
export const GPS_MINUS_TAI_NANOS = -19_000_000_000n

const SECONDS_PER_DAY = 86_400
/** JD of 1970-01-01T00:00:00 in any uniform scale's own calendar. */
export const JD_UNIX_EPOCH = 2_440_587.5
export const JD_J2000 = 2_451_545
export const MJD_OFFSET = 2_400_000.5
/** Seconds from 1970-01-01T00:00:00 to 2000-01-01T12:00:00 on a uniform calendar. */
const J2000_SECONDS_FROM_1970 = daysFromCivil(2000, 1, 1) * SECONDS_PER_DAY + 43_200
const J2000_NANOS_FROM_1970 = BigInt(J2000_SECONDS_FROM_1970) * NANOS_PER_SECOND
/** GPS epoch 1980-01-06T00:00:00 (GPS = UTC at that instant). */
const GPS_EPOCH_NANOS = BigInt(daysFromCivil(1980, 1, 6) * SECONDS_PER_DAY) * NANOS_PER_SECOND
const NANOS_PER_WEEK = 7n * NANOS_PER_DAY

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/**
 * TDB − TT in seconds for a TT time expressed as days since J2000.
 * Leading terms of the Fairhead & Bretagnon series as given in USNO Circular
 * 179 (eq. 2.6): mean anomaly of Earth, Sun−Jupiter longitude difference and
 * twice the mean anomaly. Truncation error is below ~20 µs.
 */
function tdbMinusTt(daysSinceJ2000Tt: number): number {
  const centuries = daysSinceJ2000Tt / 36_525
  const g = 6.2401 + 628.3076 * centuries
  const jupiter = 4.297 + 575.3385 * centuries
  return 0.001_657 * Math.sin(g) + 0.000_022 * Math.sin(jupiter) + 0.000_014 * Math.sin(2 * g)
}

function tdbNanosFromTt(ttNanos: bigint): bigint {
  const days = Number(ttNanos - J2000_NANOS_FROM_1970) / 86_400e9
  return ttNanos + BigInt(Math.round(tdbMinusTt(days) * 1e9))
}

function ttNanosFromTdb(tdbNanos: bigint): bigint {
  // The periodic term changes by < 1 ns over its own magnitude, so one evaluation at the TDB reading suffices.
  const days = Number(tdbNanos - J2000_NANOS_FROM_1970) / 86_400e9
  return tdbNanos - BigInt(Math.round(tdbMinusTt(days) * 1e9))
}

/**
 * The reading of `scale`'s clock at `instant`, as nanoseconds since that
 * scale's own 1970-01-01T00:00:00. For `utc` this is POSIX Unix nanoseconds.
 */
export function scaleNanos(instant: Instant, scale: TimeScale, options: UtcOptions = {}): bigint {
  switch (scale) {
    case 'tai':
      return instant.taiNanos
    case 'tt':
      return instant.taiNanos + TT_MINUS_TAI_NANOS
    case 'gps':
      return instant.taiNanos + GPS_MINUS_TAI_NANOS
    case 'tdb':
      return tdbNanosFromTt(instant.taiNanos + TT_MINUS_TAI_NANOS)
    case 'utc':
      return instantToUnixNanos(instant, options)
    default:
      return assertNever(scale)
  }
}

/** Inverse of `scaleNanos`. */
export function instantFromScaleNanos(
  nanos: bigint,
  scale: TimeScale,
  options: UtcOptions = {},
): Instant {
  switch (scale) {
    case 'tai':
      return instantFromTaiNanos(nanos)
    case 'tt':
      return instantFromTaiNanos(nanos - TT_MINUS_TAI_NANOS)
    case 'gps':
      return instantFromTaiNanos(nanos - GPS_MINUS_TAI_NANOS)
    case 'tdb':
      return instantFromTaiNanos(ttNanosFromTdb(nanos) - TT_MINUS_TAI_NANOS)
    case 'utc':
      return instantFromUnixNanos(nanos, options)
    default:
      return assertNever(scale)
  }
}

const nanosToSeconds = (nanos: bigint): number => {
  const whole = floorDiv(nanos, NANOS_PER_SECOND)
  return Number(whole) + Number(nanos - whole * NANOS_PER_SECOND) / 1e9
}

const secondsToNanos = (seconds: number): bigint => {
  if (!Number.isFinite(seconds))
    throw new RangeError(`Expected a finite number, got ${String(seconds)}`)
  const whole = Math.floor(seconds)
  return BigInt(whole) * NANOS_PER_SECOND + BigInt(Math.round((seconds - whole) * 1e9))
}

/**
 * Seconds since the J2000 epoch (2000-01-01T12:00:00 TT) as read on `scale`.
 * `secondsSinceJ2000(i, 'tdb')` is SPICE's "ephemeris time" (ET).
 * ~0.1 µs float resolution near the present; use `nanosSinceJ2000` for exactness.
 */
export const secondsSinceJ2000 = (
  instant: Instant,
  scale: TimeScale = 'tt',
  options?: UtcOptions,
): number => nanosToSeconds(nanosSinceJ2000(instant, scale, options))

export function nanosSinceJ2000(
  instant: Instant,
  scale: TimeScale = 'tt',
  options?: UtcOptions,
): bigint {
  const epoch = scaleNanos(J2000_INSTANT, scale, options)
  return scaleNanos(instant, scale, options) - epoch
}

export const instantFromSecondsSinceJ2000 = (
  seconds: number,
  scale: TimeScale = 'tt',
  options?: UtcOptions,
): Instant => instantFromNanosSinceJ2000(secondsToNanos(seconds), scale, options)

export function instantFromNanosSinceJ2000(
  nanos: bigint,
  scale: TimeScale = 'tt',
  options?: UtcOptions,
): Instant {
  const epoch = scaleNanos(J2000_INSTANT, scale, options)
  return instantFromScaleNanos(epoch + nanos, scale, options)
}

/** The J2000 epoch, 2000-01-01T12:00:00 TT. */
export const J2000_INSTANT: Instant = instantFromTaiNanos(
  J2000_NANOS_FROM_1970 - TT_MINUS_TAI_NANOS,
)

// ---------------------------------------------------------------------------
// Julian dates

export type JulianDateParts = {
  /** Integer-plus-half part (…​.5 at midnight), exact. */
  readonly jd1: number
  /** Fraction of the day, 0 ≤ jd2 < 1. */
  readonly jd2: number
}

/** Two-part Julian date on `scale` (full nanosecond precision). */
export function julianDateParts(
  instant: Instant,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): JulianDateParts {
  const nanos = scaleNanos(instant, scale, options)
  const days = floorDiv(nanos, NANOS_PER_DAY)
  return { jd1: JD_UNIX_EPOCH + Number(days), jd2: Number(nanos - days * NANOS_PER_DAY) / 86_400e9 }
}

/** Julian date on `scale` as a single float (≈50 µs resolution near the present). */
export function julianDate(
  instant: Instant,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): number {
  const { jd1, jd2 } = julianDateParts(instant, scale, options)
  return jd1 + jd2
}

export const modifiedJulianDate = (
  instant: Instant,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): number => {
  const { jd1, jd2 } = julianDateParts(instant, scale, options)
  return jd1 - MJD_OFFSET + jd2
}

export function instantFromJulianDateParts(
  jd1: number,
  jd2: number,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): Instant {
  const nanos =
    secondsToNanos((jd1 - JD_UNIX_EPOCH) * SECONDS_PER_DAY) + secondsToNanos(jd2 * SECONDS_PER_DAY)
  return instantFromScaleNanos(nanos, scale, options)
}

export const instantFromJulianDate = (
  jd: number,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): Instant => instantFromJulianDateParts(jd, 0, scale, options)

export const instantFromModifiedJulianDate = (
  mjd: number,
  scale: TimeScale = 'utc',
  options?: UtcOptions,
): Instant => instantFromJulianDateParts(MJD_OFFSET, mjd, scale, options)

// ---------------------------------------------------------------------------
// GPS

export type GpsWeek = { readonly week: number; readonly secondsOfWeek: number }

/** GPS week number and seconds into the week (no roll-over). */
export function gpsWeek(instant: Instant): GpsWeek {
  const gps = instant.taiNanos + GPS_MINUS_TAI_NANOS - GPS_EPOCH_NANOS
  const week = floorDiv(gps, NANOS_PER_WEEK)
  return { week: Number(week), secondsOfWeek: nanosToSeconds(gps - week * NANOS_PER_WEEK) }
}

export const instantFromGpsWeek = (week: number, secondsOfWeek: number): Instant =>
  instantFromTaiNanos(
    GPS_EPOCH_NANOS +
      BigInt(week) * NANOS_PER_WEEK +
      secondsToNanos(secondsOfWeek) -
      GPS_MINUS_TAI_NANOS,
  )

/** GPS seconds since the GPS epoch (1980-01-06T00:00:00). */
export const gpsSeconds = (instant: Instant): number =>
  nanosToSeconds(instant.taiNanos + GPS_MINUS_TAI_NANOS - GPS_EPOCH_NANOS)

export const instantFromGpsSeconds = (seconds: number): Instant =>
  instantFromTaiNanos(GPS_EPOCH_NANOS + secondsToNanos(seconds) - GPS_MINUS_TAI_NANOS)

// ---------------------------------------------------------------------------
// Civil time in any scale

/** Broken-down time as read on `scale`. Only `utc` can report `second: 60`. */
export function instantToCivil(
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): UtcDateTime {
  if (scale === 'utc') return instantToUtc(instant, options)
  const nanos = scaleNanos(instant, scale, options)
  const seconds = floorDiv(nanos, NANOS_PER_SECOND)
  return civilFromUnixSeconds(Number(seconds), Number(nanos - seconds * NANOS_PER_SECOND))
}

/** Civil fields read on `scale` → instant. */
export function civilToInstant(
  fields: UtcFields,
  scale: TimeScale,
  options?: UtcOptions,
): Result<Instant, InvalidTimeError> {
  if (scale === 'utc') return utcToInstant(fields, options)
  const resolved = resolveCivilFields(fields)
  if (!resolved.ok) return resolved
  const { days, secondOfDay, second, nanosecond } = resolved.value
  if (second === 60)
    return err(new InvalidTimeError('second', 60, `${scale.toUpperCase()} has no leap seconds`))
  const nanos = BigInt(days * SECONDS_PER_DAY + secondOfDay) * NANOS_PER_SECOND + BigInt(nanosecond)
  return ok(instantFromScaleNanos(nanos, scale, options))
}
