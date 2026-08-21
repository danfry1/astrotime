import { assertNever } from './assert.js'
import { daysFromCivil } from './calendar.js'
import { NANOS_PER_DAY, NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError } from './errors.js'
import {
  type CivilDateTime,
  type CivilFields,
  assertSupportedCivilRange,
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
import { assertSafeInteger, deterministicSin, floorDiv, fromNanos, toNanos } from './numeric.js'
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

export const TIME_SCALES = Object.freeze([
  'utc',
  'tai',
  'tt',
  'gps',
  'tdb',
] as const satisfies readonly TimeScale[])

/** Upper-case designators used when formatting/parsing non-UTC readings (`… TAI`). */
export const TIME_SCALE_LABELS = Object.freeze({
  utc: 'UTC',
  tai: 'TAI',
  tt: 'TT',
  gps: 'GPS',
  tdb: 'TDB',
} as const satisfies Record<TimeScale, string>)

/** Internal runtime guard for JavaScript callers (TypeScript checks this statically). */
export function assertTimeScale(scale: unknown): asserts scale is TimeScale {
  if (scale !== 'utc' && scale !== 'tai' && scale !== 'tt' && scale !== 'gps' && scale !== 'tdb') {
    throw new RangeError(`Unsupported time scale: ${String(scale)}`)
  }
}

/** TT − TAI: exactly 32.184 s, as nanoseconds. */
export const TT_MINUS_TAI_NANOS = 32_184_000_000n
/** GPS − TAI: exactly −19 s, as nanoseconds. */
export const GPS_MINUS_TAI_NANOS = -19_000_000_000n

const SECONDS_PER_DAY = 86_400
/** JD of 1970-01-01T00:00:00 on any scale's own calendar. */
export const JD_UNIX_EPOCH = 2_440_587.5
/** Julian date of the J2000 epoch (2000-01-01T12:00:00 TT). */
export const JD_J2000 = 2_451_545
/** JD − MJD (2 400 000.5). */
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
  if (
    !Number.isFinite(g) ||
    !Number.isFinite(jupiter) ||
    Math.abs(g) > 5e8 ||
    Math.abs(jupiter) > 1e9
  ) {
    throw new RangeError('TDB approximation is outside its numerically supported argument range')
  }
  // deterministicSin keeps TDB bit-identical across JS engines (Math.sin is not specified exactly).
  return (
    0.001_657 * deterministicSin(g) +
    0.000_022 * deterministicSin(jupiter) +
    0.000_014 * deterministicSin(2 * g)
  )
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

/**
 * Converts a scale reading back to an instant. Exact inverse of
 * `instantToScaleNanos` for the uniform scales (`tai`, `tt`, `gps`, `tdb`).
 * For `'utc'` the reading is POSIX time, which is **not injective**: an
 * inserted leap second shares its Unix value with the following second (this
 * conversion picks the post-leap instant), and a deleted second's value never
 * occurs (handled per `UtcOptions.leapGap`). Use `instantFromUtc` with civil
 * fields when leap-second identity matters.
 */
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

/**
 * Converts float scale seconds back to an instant. Float seconds near the
 * present carry ~240 ns double resolution (ULP at ~1.8e9 s), so the round
 * trip with `instantToScaleSeconds` is exact only to that resolution — use
 * the `*ScaleNanos` pair for exactness. UTC input follows POSIX semantics.
 */
export const instantFromScaleSeconds = (
  seconds: number,
  scale: TimeScale,
  options?: UtcOptions,
): Instant =>
  instantFromScaleNanos(toNanos(seconds, NANOS_PER_SECOND, 'scale seconds'), scale, options)

// ---------------------------------------------------------------------------
// J2000

/**
 * Seconds since 2000-01-01T12:00:00 **as read on `scale`'s own clock** — the
 * standard per-scale J2000 origin. `instantToJ2000Seconds(i, 'tdb')` follows
 * the SPICE ephemeris-time convention (ET = 0 at 2000-01-01T12:00:00 TDB) but
 * is **approximate ET**: the TDB−TT model is a three-term series that agrees
 * with CSPICE/ERFA to < 30 µs over 1972–2100 (validated in CI; error grows
 * slowly outside that interval). `'tt'` gives TT seconds past the IAU J2000.0
 * epoch, exactly. Origins of different scales differ by up to ΔAT + 32.184 s.
 * ~0.1 µs float resolution near the present; use `instantToJ2000Nanos` for exactness.
 */
export const instantToJ2000Seconds = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number => fromNanos(instantToJ2000Nanos(instant, scale, options), NANOS_PER_SECOND)

/** J2000 UTC noon (2000-01-01T12:00:00Z) as Unix nanoseconds. */
const J2000_UTC_UNIX_NANOS = 946_728_000n * NANOS_PER_SECOND

const j2000OriginNanos = (scale: TimeScale): bigint =>
  scale === 'utc' ? J2000_UTC_UNIX_NANOS : J2000_NANOS_FROM_1970

/** Exact nanoseconds since 2000-01-01T12:00:00 as read on `scale` (see `instantToJ2000Seconds`). */
export const instantToJ2000Nanos = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): bigint => instantToScaleNanos(instant, scale, options) - j2000OriginNanos(scale)

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
): Instant => instantFromScaleNanos(j2000OriginNanos(scale) + nanos, scale, options)

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
  const numericDays = Number(days)
  const jd1 = JD_UNIX_EPOCH + numericDays
  if (!Number.isSafeInteger(numericDays) || Math.abs(jd1 % 1) !== 0.5) {
    throw new RangeError('Instant is outside the exact two-part Julian-date day range')
  }
  return { jd1, jd2: Number(nanos - days * NANOS_PER_DAY) / 86_400e9 }
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

/** Modified Julian Date (JD − 2 400 000.5) on `scale` as a single float. */
export const instantToModifiedJulianDate = (
  instant: Instant,
  scale: TimeScale,
  options?: UtcOptions,
): number => {
  const { jd1, jd2 } = instantToJulianDateParts(instant, scale, options)
  return jd1 - MJD_OFFSET + jd2
}

/** Inverse of `instantToJulianDateParts` (UTC input uses the same quasi-JD convention). */
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
  // Quasi-JD: split each part before combining it. Adding a fraction within
  // ~1e-14 of 1 directly to a day count around 10^3 can round across midnight;
  // on a leap day that loses the identity of 23:59:60.999999999. Keeping both
  // remainders near [0, 1) preserves the information carried by a two-part JD.
  const fromEpoch = jd1 - JD_UNIX_EPOCH
  const whole1 = Math.floor(fromEpoch)
  const whole2 = Math.floor(jd2)
  let dayIndex = whole1 + whole2
  if (!Number.isSafeInteger(dayIndex)) {
    throw new RangeError(
      `Julian date is outside the safe-integer civil day range: ${String(dayIndex)}`,
    )
  }
  let fraction = fromEpoch - whole1 + (jd2 - whole2)
  if (fraction < 0) {
    dayIndex -= 1
    fraction += 1
  } else if (fraction >= 1) {
    dayIndex += 1
    fraction -= 1
  }
  const dayStart = dayIndex * SECONDS_PER_DAY
  if (!Number.isSafeInteger(dayStart)) {
    throw new RangeError(`Julian date is outside the exact UTC-second range: ${String(dayIndex)}`)
  }
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

/** Instant from a single-float Julian date on `scale` (≈50 µs resolution; prefer the two-part form). */
export const instantFromJulianDate = (
  jd: number,
  scale: TimeScale,
  options?: UtcOptions,
): Instant => instantFromJulianDateParts(jd, 0, scale, options)

/** Instant from a Modified Julian Date on `scale`. */
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
  const numericWeek = Number(week)
  if (!Number.isSafeInteger(numericWeek)) {
    throw new RangeError('Instant is outside the safe-integer GPS week range')
  }
  return {
    week: numericWeek,
    secondsOfWeek: fromNanos(gps - week * NANOS_PER_WEEK, NANOS_PER_SECOND),
  }
}

/** Instant from a safe-integer GPS week and fractional seconds of week in `[0, 604800)`. */
export function instantFromGpsWeek(week: number, secondsOfWeek: number): Instant {
  assertSafeInteger(week, 'GPS week')
  const secondsNanos = toNanos(secondsOfWeek, NANOS_PER_SECOND, 'GPS seconds of week')
  if (secondsNanos < 0n || secondsNanos >= NANOS_PER_WEEK) {
    throw new RangeError(
      `GPS seconds of week must be between 0 (inclusive) and 604800 (exclusive), got ${String(secondsOfWeek)}`,
    )
  }
  return instantFromTaiNanos(
    GPS_EPOCH_NANOS + BigInt(week) * NANOS_PER_WEEK + secondsNanos - GPS_MINUS_TAI_NANOS,
  )
}

/** GPS seconds since the GPS epoch (1980-01-06T00:00:00). */
export const instantToGpsSeconds = (instant: Instant): number =>
  fromNanos(instant.taiNanos + GPS_MINUS_TAI_NANOS - GPS_EPOCH_NANOS, NANOS_PER_SECOND)

/** Instant from GPS seconds since the GPS epoch (1980-01-06T00:00:00). */
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
  return assertSupportedCivilRange(
    civilFromUnixSeconds(Number(seconds), Number(nanos - seconds * NANOS_PER_SECOND)),
  )
}

/** Civil fields read on `scale` → instant. */
export function instantFromCivil(
  fields: CivilFields,
  scale: TimeScale,
  options?: UtcOptions,
): Result<Instant, InvalidTimeError> {
  assertTimeScale(scale)
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
  if (unitNanos === undefined) throw new RangeError(`Unsupported truncation unit: ${unit}`)
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
