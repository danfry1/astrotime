import { civilFromDays, dayOfYear, daysFromCivil, daysInMonth, daysInYear } from './calendar.js'
import { type Duration, durationFromNanos, NANOS_PER_MILLI, NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError } from './errors.js'
import {
  IERS_LEAP_SECONDS,
  type LeapSecondTable,
  leapEntryIndexForUnix,
  PRE_1972_DELTA_AT,
} from './leap-seconds.js'
import { err, ok, type Result } from './result.js'

declare const instantBrand: unique symbol

/**
 * A point on the TAI timeline: whole nanoseconds since 1970-01-01T00:00:00 TAI.
 * TAI is uniform, so arithmetic is exact and independent of leap seconds.
 */
export type Instant = { readonly taiNanos: bigint; readonly [instantBrand]: true }

/** Options accepted by every UTC-dependent conversion. */
export type UtcOptions = {
  /** Leap-second table to use; defaults to the bundled IERS table. */
  readonly leapSeconds?: LeapSecondTable
}

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_MINUTE = 60
const MAX_NANOS = 999_999_999

const makeInstant = (taiNanos: bigint): Instant => ({ taiNanos }) as Instant

export const instantFromTaiNanos = (taiNanos: bigint): Instant => makeInstant(taiNanos)
export const taiNanosOf = (instant: Instant): bigint => instant.taiNanos

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/** Splits a possibly-fractional number of `unit`s into exact nanoseconds (rounded to nearest ns). */
function toNanos(value: number, unitNanos: bigint): bigint {
  if (!Number.isFinite(value))
    throw new RangeError(`Expected a finite number, got ${String(value)}`)
  const whole = Math.floor(value)
  const fraction = value - whole
  return BigInt(whole) * unitNanos + BigInt(Math.round(fraction * Number(unitNanos)))
}

// ---------------------------------------------------------------------------
// Leap-second lookup on the TAI axis

/** Index of the last table entry whose TAI boundary (unixSeconds + deltaAt) is ≤ taiSeconds, or -1. */
function leapEntryIndexForTai(taiSeconds: bigint, table: LeapSecondTable): number {
  let lo = 0
  let hi = table.entries.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const entry = table.entries[mid]
    if (entry !== undefined && BigInt(entry.unixSeconds + entry.deltaAt) <= taiSeconds) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** TAI − UTC (whole seconds) in effect at the instant. Inside an inserted leap second the pre-leap value applies. */
export function deltaAt(instant: Instant, options: UtcOptions = {}): number {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  const idx = leapEntryIndexForTai(floorDiv(instant.taiNanos, NANOS_PER_SECOND), table)
  return idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
}

// ---------------------------------------------------------------------------
// Unix time

/**
 * Unix nanoseconds (POSIX semantics: leap seconds are not counted, so an
 * inserted leap second repeats the Unix values of the second that follows it).
 */
export function instantToUnixNanos(instant: Instant, options: UtcOptions = {}): bigint {
  return instant.taiNanos - BigInt(deltaAt(instant, options)) * NANOS_PER_SECOND
}

/** Unix seconds (POSIX) → instant. Unix time is never ambiguous in this direction. */
export function instantFromUnixNanos(unixNanos: bigint, options: UtcOptions = {}): Instant {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  const unixSeconds = Number(floorDiv(unixNanos, NANOS_PER_SECOND))
  const idx = leapEntryIndexForUnix(unixSeconds, table)
  const delta = idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
  return makeInstant(unixNanos + BigInt(delta) * NANOS_PER_SECOND)
}

export const instantFromUnixSeconds = (seconds: number, options?: UtcOptions): Instant =>
  instantFromUnixNanos(toNanos(seconds, NANOS_PER_SECOND), options)

export const instantFromUnixMillis = (millis: number, options?: UtcOptions): Instant =>
  instantFromUnixNanos(toNanos(millis, NANOS_PER_MILLI), options)

/** Unix milliseconds as a float (sub-millisecond part kept in the fraction). */
export function instantToUnixMillis(instant: Instant, options?: UtcOptions): number {
  const nanos = instantToUnixNanos(instant, options)
  const whole = floorDiv(nanos, NANOS_PER_MILLI)
  return Number(whole) + Number(nanos - whole * NANOS_PER_MILLI) / 1e6
}

export const instantToUnixSeconds = (instant: Instant, options?: UtcOptions): number => {
  const nanos = instantToUnixNanos(instant, options)
  const whole = floorDiv(nanos, NANOS_PER_SECOND)
  return Number(whole) + Number(nanos - whole * NANOS_PER_SECOND) / 1e9
}

export const instantFromDate = (date: Date, options?: UtcOptions): Instant => {
  const ms = date.getTime()
  if (Number.isNaN(ms)) throw new RangeError('Cannot convert an invalid Date to an Instant')
  return instantFromUnixMillis(ms, options)
}

/** Nearest `Date` (millisecond precision, truncated toward −∞). */
export const instantToDate = (instant: Instant, options?: UtcOptions): Date =>
  new Date(Number(floorDiv(instantToUnixNanos(instant, options), NANOS_PER_MILLI)))

/** Current instant from the system clock (millisecond precision). Inject `now` for tests. */
export const instantNow = (options: UtcOptions & { readonly now?: () => number } = {}): Instant =>
  instantFromUnixMillis((options.now ?? Date.now)(), options)

// ---------------------------------------------------------------------------
// UTC civil time

/** Broken-down UTC time. `second` is 60 during an inserted leap second. */
export type UtcDateTime = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly dayOfYear: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly nanosecond: number
}

type TimeFields = {
  readonly hour?: number
  readonly minute?: number
  readonly second?: number
  readonly nanosecond?: number
}

/** Input to `utcToInstant`: a calendar date or an ordinal (day-of-year) date plus optional time. */
export type UtcFields =
  | ({
      readonly year: number
      readonly month: number
      readonly day: number
      readonly dayOfYear?: undefined
    } & TimeFields)
  | ({
      readonly year: number
      readonly dayOfYear: number
      readonly month?: undefined
      readonly day?: undefined
    } & TimeFields)

function checkRange(
  field: string,
  value: number,
  min: number,
  max: number,
): InvalidTimeError | null {
  if (!Number.isInteger(value)) return new InvalidTimeError(field, value, 'must be an integer')
  if (value < min || value > max)
    return new InvalidTimeError(field, value, `must be between ${String(min)} and ${String(max)}`)
  return null
}

/** Validates fields and resolves them to days-since-epoch plus seconds-of-day. Shared by all scales. */
export function resolveCivilFields(fields: UtcFields): Result<
  {
    readonly days: number
    readonly secondOfDay: number
    readonly second: number
    readonly nanosecond: number
  },
  InvalidTimeError
> {
  const hour = fields.hour ?? 0
  const minute = fields.minute ?? 0
  const second = fields.second ?? 0
  const nanosecond = fields.nanosecond ?? 0
  let days: number
  const yearError = checkRange('year', fields.year, -999_999, 999_999)
  if (yearError !== null) return err(yearError)
  if (fields.dayOfYear !== undefined) {
    const e = checkRange('dayOfYear', fields.dayOfYear, 1, daysInYear(fields.year))
    if (e !== null) return err(e)
    days = daysFromCivil(fields.year, 1, 1) + fields.dayOfYear - 1
  } else {
    const e =
      checkRange('month', fields.month, 1, 12) ??
      checkRange('day', fields.day, 1, daysInMonth(fields.year, fields.month))
    if (e !== null) return err(e)
    days = daysFromCivil(fields.year, fields.month, fields.day)
  }
  const timeError =
    checkRange('hour', hour, 0, 23) ??
    checkRange('minute', minute, 0, 59) ??
    checkRange('second', second, 0, 60) ??
    checkRange('nanosecond', nanosecond, 0, MAX_NANOS)
  if (timeError !== null) return err(timeError)
  return ok({
    days,
    secondOfDay: hour * SECONDS_PER_HOUR + minute * SECONDS_PER_MINUTE + second,
    second,
    nanosecond,
  })
}

/**
 * UTC fields → instant. Validates ranges, including that `second: 60` is only
 * accepted at an inserted leap second and that a second deleted by a negative
 * leap second is rejected.
 */
export function utcToInstant(
  fields: UtcFields,
  options: UtcOptions = {},
): Result<Instant, InvalidTimeError> {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  const resolved = resolveCivilFields(fields)
  if (!resolved.ok) return resolved
  const { days, secondOfDay, second, nanosecond } = resolved.value
  const midnightAfter = (days + 1) * SECONDS_PER_DAY
  if (second === 60) {
    if (secondOfDay !== SECONDS_PER_DAY) {
      return err(new InvalidTimeError('second', 60, 'a leap second can only occur at 23:59:60'))
    }
    const idx = leapEntryIndexForUnix(midnightAfter, table)
    const entry = table.entries[idx]
    const previous =
      idx > 0 ? (table.entries[idx - 1]?.deltaAt ?? PRE_1972_DELTA_AT) : PRE_1972_DELTA_AT
    if (
      entry === undefined ||
      entry.unixSeconds !== midnightAfter ||
      entry.deltaAt !== previous + 1
    ) {
      return err(new InvalidTimeError('second', 60, 'no leap second is inserted at this time'))
    }
    const taiSeconds = BigInt(midnightAfter + previous)
    return ok(makeInstant(taiSeconds * NANOS_PER_SECOND + BigInt(nanosecond)))
  }
  const unixSeconds = days * SECONDS_PER_DAY + secondOfDay
  const idx = leapEntryIndexForUnix(unixSeconds, table)
  const delta = idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
  const next = table.entries[idx + 1]
  if (next !== undefined && next.unixSeconds === unixSeconds + 1 && next.deltaAt < delta) {
    return err(
      new InvalidTimeError('second', second, 'this second is deleted by a negative leap second'),
    )
  }
  return ok(makeInstant(BigInt(unixSeconds + delta) * NANOS_PER_SECOND + BigInt(nanosecond)))
}

/** Breaks an instant into UTC fields. Leap seconds are reported as `second: 60`. */
export function instantToUtc(instant: Instant, options: UtcOptions = {}): UtcDateTime {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  const taiSeconds = floorDiv(instant.taiNanos, NANOS_PER_SECOND)
  const nanosecond = Number(instant.taiNanos - taiSeconds * NANOS_PER_SECOND)
  const idx = leapEntryIndexForTai(taiSeconds, table)
  const delta = idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
  let unixSeconds = Number(taiSeconds) - delta
  let second60 = false
  const next = table.entries[idx + 1]
  if (next !== undefined && next.deltaAt > delta && unixSeconds >= next.unixSeconds) {
    // Inside the inserted second: present it as 23:59:60 of the preceding day.
    second60 = true
    unixSeconds = next.unixSeconds - 1
  }
  return civilFromUnixSeconds(unixSeconds, nanosecond, second60)
}

export function civilFromUnixSeconds(
  unixSeconds: number,
  nanosecond: number,
  second60 = false,
): UtcDateTime {
  const days = Math.floor(unixSeconds / SECONDS_PER_DAY)
  const secondOfDay = unixSeconds - days * SECONDS_PER_DAY
  const { year, month, day } = civilFromDays(days)
  return {
    year,
    month,
    day,
    dayOfYear: dayOfYear(year, month, day),
    hour: Math.floor(secondOfDay / SECONDS_PER_HOUR),
    minute: Math.floor((secondOfDay % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    second: second60 ? 60 : secondOfDay % SECONDS_PER_MINUTE,
    nanosecond,
  }
}

// ---------------------------------------------------------------------------
// Arithmetic

export const addDuration = (instant: Instant, d: Duration): Instant =>
  makeInstant(instant.taiNanos + d.nanos)
export const subtractDuration = (instant: Instant, d: Duration): Instant =>
  makeInstant(instant.taiNanos - d.nanos)
/** `end − start` as an exact elapsed duration (leap seconds included). */
export const durationBetween = (start: Instant, end: Instant): Duration =>
  durationFromNanos(end.taiNanos - start.taiNanos)
export const compareInstants = (a: Instant, b: Instant): -1 | 0 | 1 =>
  a.taiNanos < b.taiNanos ? -1 : a.taiNanos > b.taiNanos ? 1 : 0
export const instantsEqual = (a: Instant, b: Instant): boolean => a.taiNanos === b.taiNanos
