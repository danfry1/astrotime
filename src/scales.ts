import { assertNever } from './assert.js'
import { daysFromCivil } from './calendar.js'
import { NANOS_PER_DAY, NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError } from './errors.js'
import {
  type CivilDateTime,
  type CivilFields,
  civilFromUnixSeconds,
  type Instant,
  instantFromResolvedUtc,
  instantFromTaiNanos,
  instantFromUnixNanos,
  instantFromUtc,
  instantToUnixNanos,
  instantToUtc,
  isLeapSecond,
  resolveCivilFields,
  type UtcOptions,
} from './instant.js'
import { IERS_LEAP_SECONDS, leapEntryIndexForUnix, PRE_1972_DELTA_AT } from './leap-seconds.js'
import { assertInteger, floorDiv, fromNanos, toNanos } from './numeric.js'
import { err, ok, type Result } from './result.js'

/**
 * Supported time scales.
 * - `utc` — Coordinated Universal Time (leap seconds).
 * - `tai` — International Atomic Time (uniform).
 * - `tt`  — Terrestrial Time = TAI + 32.184 s.
 * - `gps` — GPS time = TAI − 19 s.
 * - `tdb` — Barycentric Dynamical Time ≈ TT + periodic terms (≤ 1.7 ms;
 *           this implementation agrees with ERFA's full series to < 30 µs).
 */
export type TimeScale = 'utc' | 'tai' | 'tt' | 'gps' | 'tdb'

export const TIME_SCALES = [
  'utc',
  'tai',
  'tt',
  'gps',
  'tdb',
] as const satisfies readonly TimeScale[]

/** Upper-case designators used when formatting/parsing non-UTC readings (`… TAI`). */
export const TIME_SCALE_LABELS = {
  utc: 'UTC',
  tai: 'TAI',
  tt: 'TT',
  gps: 'GPS',
  tdb: 'TDB',
} as const satisfies Record<TimeScale, string>

export const TT_MINUS_TAI_NANOS = 32_184_000_000n
export const GPS_MINUS_TAI_NANOS = -19_000_000_000n

const SECONDS_PER_DAY = 86_400
/** JD of 1970-01-01T00:00:00 on any scale's own calendar. */
export const JD_UNIX_EPOCH = 2_440_587.5
export const JD_J2000 = 2_451_545
export const MJD_OFFSET = 2_400_000.5
/** Seconds from 1970-01-01T00:00:00 to 2000-01-01T12:00:00 on a uniform calendar. */
const J2000_SECONDS_FROM_1970 = daysFromCivil(2000, 1, 1) * SECONDS_PER_DAY + 43_200
const J2000_NANOS_FROM_1970 = BigInt(J2000_SECONDS_FROM_1970) * NANOS_PER_SECOND
/** GPS epoch 1980-01-06T00:00:00 (GPS = UTC at that instant). */
const GPS_EPOCH_NANOS = BigInt(daysFromCivil(1980, 1, 6) * SECONDS_PER_DAY) * NANOS_PER_SECOND
const NANOS_PER_WEEK = 7n * NANOS_PER_DAY

/** The J2000 epoch, 2000-01-01T12:00:00 TT (= 11:58:55.816 UTC). */
export const J2000_INSTANT: Instant = instantFromTaiNanos(
  J2000_NANOS_FROM_1970 - TT_MINUS_TAI_NANOS,
)
/** The GPS epoch, 1980-01-06T00:00:00 UTC (GPS week 0, second 0). */
export const GPS_EPOCH_INSTANT: Instant = instantFromTaiNanos(GPS_EPOCH_NANOS - GPS_MINUS_TAI_NANOS)

/**
 * TDB − TT in seconds for a TT time expressed as days since J2000.
 * Leading terms of the Fairhead & Bretagnon series as given in USNO Circular
 * 179 (eq. 2.6): mean anomaly of Earth, Sun−Jupiter longitude difference and
 * twice the mean anomaly. Agrees with ERFA `dtdb` to < 30 µs (1972–2100).
 */
function tdbMinusTt(daysSinceJ2000Tt: number): number {
  const centuries = daysSinceJ2000Tt / 36_525
  const g = 6.2401 + 628.3076 * centuries
  const jupiter = 4.297 + 575.3385 * centuries
  return 0.001_657 * Math.sin(g) + 0.000_022 * Math.sin(jupiter) + 0.000_014 * Math.sin(2 * g)
}

const tdbOffsetNanos = (ttNanos: bigint): bigint =>
  BigInt(Math.round(tdbMinusTt(Number(ttNanos - J2000_NANOS_FROM_1970) / 86_400e9) * 1e9))

const tdbNanosFromTt = (ttNanos: bigint): bigint => ttNanos + tdbOffsetNanos(ttNanos)

function ttNanosFromTdb(tdbNanos: bigint): bigint {
  // Fixed-point iteration: evaluate the offset at the candidate TT so both
  // directions round the same value and the round trip is exact.
  const candidate = tdbNanos - tdbOffsetNanos(tdbNanos)
  return tdbNanos - tdbOffsetNanos(candidate)
}

/**
 * The reading of `scale`'s clock at `instant`, as nanoseconds since that
 * scale's own 1970-01-01T00:00:00. For `utc` this is POSIX Unix nanoseconds.
 */
export function instantToScaleNanos(
  instant: Instant,
  scale: TimeScale,
  options: UtcOptions = {},
): bigint {
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

/** Inverse of `instantToScaleNanos`. */
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

/** Float seconds on `scale`'s clock since its 1970-01-01T00:00:00 reading. */
export const instantToScaleSeconds = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number => fromNanos(instantToScaleNanos(instant, scale, options), NANOS_PER_SECOND)

// ---------------------------------------------------------------------------
// J2000

/**
 * Seconds since the J2000 epoch (2000-01-01T12:00:00 TT) as read on `scale`.
 * `instantToJ2000Seconds(i, 'tdb')` is SPICE's "ephemeris time" (ET).
 * ~0.1 µs float resolution near the present; use `instantToJ2000Nanos` for exactness.
 */
export const instantToJ2000Seconds = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number => fromNanos(instantToJ2000Nanos(instant, scale, options), NANOS_PER_SECOND)

export const instantToJ2000Nanos = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): bigint =>
  instantToScaleNanos(instant, scale, options) - instantToScaleNanos(J2000_INSTANT, scale, options)

export const instantFromJ2000Seconds = (
  seconds: number,
  scale: TimeScale,
  options?: UtcOptions,
): Instant =>
  instantFromJ2000Nanos(toNanos(seconds, NANOS_PER_SECOND, 'J2000 seconds'), scale, options)

export const instantFromJ2000Nanos = (
  nanos: bigint,
  scale: TimeScale,
  options?: UtcOptions,
): Instant =>
  instantFromScaleNanos(instantToScaleNanos(J2000_INSTANT, scale, options) + nanos, scale, options)

// ---------------------------------------------------------------------------
// Julian dates

export type JulianDateParts = {
  /** Integer-plus-half part (….5 at midnight), exact. */
  readonly jd1: number
  /** Fraction of the day, 0 ≤ jd2 < 1. */
  readonly jd2: number
}

/** Length in seconds of the UTC day starting at `dayStartUnix` (86 401 / 86 399 on leap-second days). */
function utcDayLength(dayStartUnix: number, options: UtcOptions): number {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  const idx = leapEntryIndexForUnix(dayStartUnix, table)
  const current =
    idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
  const next = table.entries[idx + 1]
  if (next !== undefined && next.unixSeconds === dayStartUnix + SECONDS_PER_DAY)
    return SECONDS_PER_DAY + next.deltaAt - current
  return SECONDS_PER_DAY
}

/**
 * Two-part Julian date on `scale` (full nanosecond precision). For `utc` the
 * SOFA/ERFA "quasi-JD" convention is used: a day containing a leap second is
 * 86 401 s long and `23:59:60` lies inside it, so UTC JD is monotonic.
 */
export function instantToJulianDateParts(
  instant: Instant,
  scale: TimeScale,
  options: UtcOptions = {},
): JulianDateParts {
  if (scale === 'utc') {
    const civil = instantToUtc(instant, options)
    const days = daysFromCivil(civil.year, civil.month, civil.day)
    const secondOfDay =
      civil.hour * 3_600 + civil.minute * 60 + civil.second + civil.nanosecond / 1e9
    return {
      jd1: JD_UNIX_EPOCH + days,
      jd2: secondOfDay / utcDayLength(days * SECONDS_PER_DAY, options),
    }
  }
  const nanos = instantToScaleNanos(instant, scale, options)
  const days = floorDiv(nanos, NANOS_PER_DAY)
  return { jd1: JD_UNIX_EPOCH + Number(days), jd2: Number(nanos - days * NANOS_PER_DAY) / 86_400e9 }
}

/** Julian date on `scale` as a single float (≈50 µs resolution near the present). */
export function instantToJulianDate(
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number {
  const { jd1, jd2 } = instantToJulianDateParts(instant, scale, options)
  return jd1 + jd2
}

export const instantToModifiedJulianDate = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number => {
  const { jd1, jd2 } = instantToJulianDateParts(instant, scale, options)
  return jd1 - MJD_OFFSET + jd2
}

export function instantFromJulianDateParts(
  jd1: number,
  jd2: number,
  scale: TimeScale,
  options: UtcOptions = {},
): Instant {
  if (!Number.isFinite(jd1) || !Number.isFinite(jd2))
    throw new RangeError('Julian date parts must be finite numbers')
  if (scale !== 'utc') {
    const nanos =
      toNanos((jd1 - JD_UNIX_EPOCH) * SECONDS_PER_DAY, NANOS_PER_SECOND, 'Julian date') +
      toNanos(jd2 * SECONDS_PER_DAY, NANOS_PER_SECOND, 'Julian date')
    return instantFromScaleNanos(nanos, scale, options)
  }
  // Quasi-JD: split into whole days and a fraction of that UTC day's true length.
  const dayIndex = Math.floor(jd1 - JD_UNIX_EPOCH + jd2)
  const fraction = jd1 - JD_UNIX_EPOCH - dayIndex + jd2
  const dayStart = dayIndex * SECONDS_PER_DAY
  const seconds = fraction * utcDayLength(dayStart, options)
  const whole = Math.min(Math.floor(seconds), SECONDS_PER_DAY)
  const nanosecond = Number(toNanos(seconds - whole, NANOS_PER_SECOND, 'Julian date'))
  if (whole === SECONDS_PER_DAY) {
    const leap = instantFromResolvedUtc(
      { days: dayIndex, secondOfDay: SECONDS_PER_DAY, second: 60, nanosecond },
      options,
    )
    if (leap.ok) return leap.value
  }
  return instantFromUnixNanos(
    BigInt(dayStart + whole) * NANOS_PER_SECOND + BigInt(nanosecond),
    options,
  )
}

export const instantFromJulianDate = (
  jd: number,
  scale: TimeScale,
  options?: UtcOptions,
): Instant => instantFromJulianDateParts(jd, 0, scale, options)

export const instantFromModifiedJulianDate = (
  mjd: number,
  scale: TimeScale,
  options?: UtcOptions,
): Instant => instantFromJulianDateParts(MJD_OFFSET, mjd, scale, options)

// ---------------------------------------------------------------------------
// GPS

export type GpsWeek = { readonly week: number; readonly secondsOfWeek: number }

/** GPS week number and seconds into the week (no 1024-week roll-over). */
export function instantToGpsWeek(instant: Instant): GpsWeek {
  const gps = instant.taiNanos + GPS_MINUS_TAI_NANOS - GPS_EPOCH_NANOS
  const week = floorDiv(gps, NANOS_PER_WEEK)
  return {
    week: Number(week),
    secondsOfWeek: fromNanos(gps - week * NANOS_PER_WEEK, NANOS_PER_SECOND),
  }
}

export function instantFromGpsWeek(week: number, secondsOfWeek: number): Instant {
  assertInteger(week, 'GPS week')
  return instantFromTaiNanos(
    GPS_EPOCH_NANOS +
      BigInt(week) * NANOS_PER_WEEK +
      toNanos(secondsOfWeek, NANOS_PER_SECOND, 'GPS seconds of week') -
      GPS_MINUS_TAI_NANOS,
  )
}

/** GPS seconds since the GPS epoch (1980-01-06T00:00:00). */
export const instantToGpsSeconds = (instant: Instant): number =>
  fromNanos(instant.taiNanos + GPS_MINUS_TAI_NANOS - GPS_EPOCH_NANOS, NANOS_PER_SECOND)

export const instantFromGpsSeconds = (seconds: number): Instant =>
  instantFromTaiNanos(
    GPS_EPOCH_NANOS + toNanos(seconds, NANOS_PER_SECOND, 'GPS seconds') - GPS_MINUS_TAI_NANOS,
  )

// ---------------------------------------------------------------------------
// Civil time in any scale

/** Broken-down time as read on `scale`. Only `utc` can report `second: 60`. */
export function instantToCivil(
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): CivilDateTime {
  if (scale === 'utc') return instantToUtc(instant, options)
  const nanos = instantToScaleNanos(instant, scale, options)
  const seconds = floorDiv(nanos, NANOS_PER_SECOND)
  return civilFromUnixSeconds(Number(seconds), Number(nanos - seconds * NANOS_PER_SECOND))
}

/** Civil fields read on `scale` → instant. */
export function instantFromCivil(
  fields: CivilFields,
  scale: TimeScale,
  options?: UtcOptions,
): Result<Instant, InvalidTimeError> {
  if (scale === 'utc') return instantFromUtc(fields, options)
  const resolved = resolveCivilFields(fields)
  if (!resolved.ok) return resolved
  const { days, secondOfDay, second, nanosecond } = resolved.value
  if (second === 60)
    return err(
      new InvalidTimeError('second', 60, `${TIME_SCALE_LABELS[scale]} has no leap seconds`),
    )
  const nanos = BigInt(days * SECONDS_PER_DAY + secondOfDay) * NANOS_PER_SECOND + BigInt(nanosecond)
  return ok(instantFromScaleNanos(nanos, scale, options))
}

// ---------------------------------------------------------------------------
// Truncation

export type TruncateUnit = 'day' | 'hour' | 'minute' | 'second' | 'millisecond' | 'microsecond'

const UNIT_NANOS: Record<TruncateUnit, bigint> = {
  day: NANOS_PER_DAY,
  hour: 3_600n * NANOS_PER_SECOND,
  minute: 60n * NANOS_PER_SECOND,
  second: NANOS_PER_SECOND,
  millisecond: 1_000_000n,
  microsecond: 1_000n,
}

/**
 * Rounds down to the start of a `unit` as read on `scale` (a UTC day boundary
 * differs from a TAI day boundary by ΔAT). Inside a UTC leap second,
 * truncating to a second or finer stays within `23:59:60`.
 */
export function truncateInstant(
  instant: Instant,
  unit: TruncateUnit,
  scale: TimeScale,
  options: UtcOptions = {},
): Instant {
  const unitNanos = UNIT_NANOS[unit]
  if (scale === 'utc' && isLeapSecond(instant, options)) {
    if (unitNanos <= NANOS_PER_SECOND)
      return instantFromTaiNanos(floorDiv(instant.taiNanos, unitNanos) * unitNanos)
    // Treat 23:59:60.x as 23:59:59.x for coarser boundaries so we land on the same day.
    const unix = instantToUnixNanos(instant, options) - NANOS_PER_SECOND
    return instantFromUnixNanos(floorDiv(unix, unitNanos) * unitNanos, options)
  }
  const nanos = instantToScaleNanos(instant, scale, options)
  return instantFromScaleNanos(floorDiv(nanos, unitNanos) * unitNanos, scale, options)
}
