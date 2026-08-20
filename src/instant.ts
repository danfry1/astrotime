import { civilFromDays, daysFromCivil, daysInMonth, daysInYear } from './calendar.js'
import { type Duration, durationFromNanos, NANOS_PER_MILLI, NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError } from './errors.js'
import {
  assertValidLeapSecondTable,
  IERS_LEAP_SECONDS,
  type LeapSecondTable,
  leapEntryIndexForUnix,
  PRE_1972_DELTA_AT,
} from './leap-seconds.js'
import { fromNanos, toNanos } from './numeric.js'
import { fractionDigits, pad } from './pattern.js'
import { err, ok, type Result } from './result.js'

declare const instantBrand: unique symbol

/**
 * A point on the TAI timeline: whole nanoseconds since 1970-01-01T00:00:00 TAI.
 * TAI is uniform, so arithmetic is exact and independent of leap seconds.
 * Values are immutable; `JSON.stringify` / `String()` yield the canonical
 * nanosecond-precision UTC ISO string (`2026-08-19T12:34:56.789012345Z`).
 */
export type Instant = InstantValue

/** Options accepted by every UTC-dependent conversion. */
export type UtcOptions = {
  /** Leap-second table to use; defaults to the bundled IERS table. */
  readonly leapSeconds?: LeapSecondTable | undefined
  /**
   * UTC is only defined from 1972-01-01. `'approximate'` (default) treats
   * earlier times as TAI − 10 s; `'reject'` returns/throws an `InvalidTimeError`.
   */
  readonly before1972?: 'approximate' | 'reject' | undefined
}

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_MINUTE = 60
const MAX_NANOS = 999_999_999
/** 1972-01-01T00:00:00 UTC as Unix seconds — the start of leap-second UTC. */
const UTC_START_UNIX_SECONDS = 63_072_000

class InstantValue {
  declare readonly [instantBrand]: true
  readonly taiNanos: bigint
  constructor(taiNanos: bigint) {
    this.taiNanos = taiNanos
    Object.freeze(this)
  }
  toJSON(): string {
    return isoNanos(instantToUtc(this))
  }
  toString(): string {
    return isoNanos(instantToUtc(this))
  }
}

const makeInstant = (taiNanos: bigint): Instant => new InstantValue(taiNanos)

const isoNanos = (c: CivilDateTime): string =>
  `${c.year < 0 ? `-${pad(-c.year, 4)}` : c.year > 9999 ? `+${pad(c.year, 6)}` : pad(c.year, 4)}-${pad(c.month, 2)}-${pad(c.day, 2)}T${pad(c.hour, 2)}:${pad(c.minute, 2)}:${pad(c.second, 2)}.${fractionDigits(c.nanosecond, 9)}Z`

/** Instant from exact TAI nanoseconds since 1970-01-01T00:00:00 TAI. */
export const instantFromTaiNanos = (taiNanos: bigint): Instant => makeInstant(taiNanos)
/** The exact TAI nanosecond count (for storage or binary protocols). */
export const instantToTaiNanos = (instant: Instant): bigint => instant.taiNanos
/** Type guard: `true` only for values created by this library's instant constructors. */
export const isInstant = (value: unknown): value is Instant => value instanceof InstantValue

/** The Unix epoch, 1970-01-01T00:00:00 UTC (= TAI 00:00:10). */
export const UNIX_EPOCH_INSTANT: Instant = makeInstant(BigInt(PRE_1972_DELTA_AT) * NANOS_PER_SECOND)
/** 1972-01-01T00:00:00 UTC, the first instant of leap-second UTC. */
export const UTC_START_INSTANT: Instant = makeInstant(
  BigInt(UTC_START_UNIX_SECONDS + PRE_1972_DELTA_AT) * NANOS_PER_SECOND,
)

const resolveTable = (options: UtcOptions): LeapSecondTable => {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  assertValidLeapSecondTable(table)
  return table
}

// ---------------------------------------------------------------------------
// Leap-second lookup on the TAI axis

/** Per-table cache of TAI boundaries (unixSeconds + deltaAt) as plain numbers, ascending. */
const taiBoundaryCache = new WeakMap<LeapSecondTable, Float64Array>()

function taiBoundaries(table: LeapSecondTable): Float64Array {
  const cached = taiBoundaryCache.get(table)
  if (cached !== undefined) return cached
  const bounds = new Float64Array(table.entries.length)
  table.entries.forEach((entry, i) => {
    bounds[i] = entry.unixSeconds + entry.deltaAt
  })
  taiBoundaryCache.set(table, bounds)
  return bounds
}

/** Index of the last table entry whose TAI boundary (unixSeconds + deltaAt) is ≤ taiSeconds, or -1. */
function leapEntryIndexForTai(taiSeconds: bigint, table: LeapSecondTable): number {
  const bounds = taiBoundaries(table)
  // |taiSeconds| < 2^53 for any date the calendar code can represent, so this comparison is exact.
  const t = Number(taiSeconds)
  let lo = 0
  let hi = bounds.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((bounds[mid] ?? Number.POSITIVE_INFINITY) <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

const deltaAtIndex = (table: LeapSecondTable, idx: number): number =>
  idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)

/** Splits TAI nanoseconds into floor seconds and a 0–999 999 999 remainder. */
function splitSeconds(taiNanos: bigint): { readonly seconds: bigint; readonly nanos: number } {
  let seconds = taiNanos / NANOS_PER_SECOND
  let rem = taiNanos - seconds * NANOS_PER_SECOND
  if (rem < 0n) {
    seconds -= 1n
    rem += NANOS_PER_SECOND
  }
  return { seconds, nanos: Number(rem) }
}

/** TAI − UTC (whole seconds) in effect at the instant. Inside an inserted leap second the pre-leap value applies. */
export function deltaAt(instant: Instant, options: UtcOptions = {}): number {
  const table = resolveTable(options)
  return deltaAtIndex(table, leapEntryIndexForTai(splitSeconds(instant.taiNanos).seconds, table))
}

/** Whether the instant falls inside an inserted leap second (UTC `23:59:60`). */
export function isLeapSecond(instant: Instant, options: UtcOptions = {}): boolean {
  const table = resolveTable(options)
  const { seconds } = splitSeconds(instant.taiNanos)
  const idx = leapEntryIndexForTai(seconds, table)
  const delta = deltaAtIndex(table, idx)
  const next = table.entries[idx + 1]
  return next !== undefined && next.deltaAt > delta && Number(seconds) - delta >= next.unixSeconds
}

/** Whether leap-second UTC is defined at the instant (i.e. it is not before 1972-01-01 UTC). */
export const isUtcDefined = (instant: Instant): boolean =>
  instant.taiNanos >= UTC_START_INSTANT.taiNanos

function rejectBefore1972(instant: Instant, options: UtcOptions): void {
  if (options.before1972 === 'reject' && !isUtcDefined(instant)) {
    throw new InvalidTimeError(
      'instant',
      Number(instant.taiNanos / NANOS_PER_SECOND),
      'UTC is undefined before 1972-01-01',
    )
  }
}

// ---------------------------------------------------------------------------
// Unix time

/**
 * Unix nanoseconds with POSIX semantics: leap seconds are not counted, so an
 * inserted leap second `23:59:60.x` maps to the same value as `00:00:00.x`.
 */
export function instantToUnixNanos(instant: Instant, options: UtcOptions = {}): bigint {
  rejectBefore1972(instant, options)
  return instant.taiNanos - BigInt(deltaAt(instant, options)) * NANOS_PER_SECOND
}

/** Unix nanoseconds (POSIX) → instant. Unix time is never ambiguous in this direction. */
export function instantFromUnixNanos(unixNanos: bigint, options: UtcOptions = {}): Instant {
  const table = resolveTable(options)
  const unixSeconds = Number(splitSeconds(unixNanos).seconds)
  if (options.before1972 === 'reject' && unixSeconds < UTC_START_UNIX_SECONDS) {
    throw new InvalidTimeError('unixSeconds', unixSeconds, 'UTC is undefined before 1972-01-01')
  }
  const delta = deltaAtIndex(table, leapEntryIndexForUnix(unixSeconds, table))
  return makeInstant(unixNanos + BigInt(delta) * NANOS_PER_SECOND)
}

/** Unix seconds (may be fractional; rounded to the nearest ns). Throws `RangeError` for non-finite input. */
export const instantFromUnixSeconds = (seconds: number, options?: UtcOptions): Instant =>
  instantFromUnixNanos(toNanos(seconds, NANOS_PER_SECOND, 'Unix seconds'), options)

/** Unix milliseconds (may be fractional; rounded to the nearest ns). Throws `RangeError` for non-finite input. */
export const instantFromUnixMillis = (millis: number, options?: UtcOptions): Instant =>
  instantFromUnixNanos(toNanos(millis, NANOS_PER_MILLI, 'Unix milliseconds'), options)

/** Unix milliseconds as a float (sub-millisecond part kept in the fraction). */
export const instantToUnixMillis = (instant: Instant, options?: UtcOptions): number =>
  fromNanos(instantToUnixNanos(instant, options), NANOS_PER_MILLI)

/** Unix seconds as a float (POSIX semantics; sub-second part kept in the fraction). */
export const instantToUnixSeconds = (instant: Instant, options?: UtcOptions): number =>
  fromNanos(instantToUnixNanos(instant, options), NANOS_PER_SECOND)

/** Instant from a JavaScript `Date` (millisecond precision). Throws `RangeError` for an invalid Date. */
export const instantFromDate = (date: Date, options?: UtcOptions): Instant => {
  const ms = date.getTime()
  if (Number.isNaN(ms)) throw new RangeError('Cannot convert an invalid Date to an Instant')
  return instantFromUnixMillis(ms, options)
}

/** Nearest `Date` (millisecond precision, truncated toward −∞). A leap second renders as the following second. */
export const instantToDate = (instant: Instant, options?: UtcOptions): Date =>
  new Date(Number(splitNanos(instantToUnixNanos(instant, options), NANOS_PER_MILLI)))

const splitNanos = (nanos: bigint, unit: bigint): bigint => {
  const q = nanos / unit
  return nanos - q * unit < 0n ? q - 1n : q
}

/** Current instant from the system clock (millisecond precision). Inject `now` for tests. */
export const instantNow = (
  options: UtcOptions & { readonly now?: (() => number) | undefined } = {},
): Instant => instantFromUnixMillis((options.now ?? Date.now)(), options)

// ---------------------------------------------------------------------------
// Civil time

/** Broken-down civil time in some scale. `second` is 60 only for UTC during an inserted leap second. */
export type CivilDateTime = {
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
  readonly hour?: number | undefined
  readonly minute?: number | undefined
  readonly second?: number | undefined
  readonly nanosecond?: number | undefined
}

/** Calendar date plus optional time. A `dayOfYear`, if also given, must agree with month/day (so `CivilDateTime` round-trips). */
export type CalendarFields = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly dayOfYear?: number | undefined
} & TimeFields

/** Ordinal (day-of-year) date plus optional time. */
export type OrdinalFields = {
  readonly year: number
  readonly dayOfYear: number
  readonly month?: undefined
  readonly day?: undefined
} & TimeFields

/**
 * Input to `instantFromUtc` / `instantFromCivil`: either `{ year, month, day }`
 * or `{ year, dayOfYear }`, plus optional `hour`, `minute`, `second`, `nanosecond`.
 */
export type CivilFields = CalendarFields | OrdinalFields

function checkRange(
  field: string,
  value: number,
  min: number,
  max: number,
): InvalidTimeError | null {
  if (!Number.isInteger(value)) return new InvalidTimeError(field, value, 'must be an integer')
  if (value < min || value > max) {
    return new InvalidTimeError(field, value, `must be between ${String(min)} and ${String(max)}`)
  }
  return null
}

export type ResolvedCivil = {
  readonly days: number
  readonly secondOfDay: number
  readonly second: number
  readonly nanosecond: number
}

/** Validates fields and resolves them to days-since-epoch plus seconds-of-day. Shared by all scales. */
export function resolveCivilFields(fields: CivilFields): Result<ResolvedCivil, InvalidTimeError> {
  const hour = fields.hour ?? 0
  const minute = fields.minute ?? 0
  const second = fields.second ?? 0
  const nanosecond = fields.nanosecond ?? 0
  let days: number
  const yearError = checkRange('year', fields.year, -999_999, 999_999)
  if (yearError !== null) return err(yearError)
  if (fields.month === undefined) {
    const e = checkRange('dayOfYear', fields.dayOfYear, 1, daysInYear(fields.year))
    if (e !== null) return err(e)
    days = daysFromCivil(fields.year, 1, 1) + fields.dayOfYear - 1
  } else {
    const e =
      checkRange('month', fields.month, 1, 12) ??
      checkRange('day', fields.day, 1, daysInMonth(fields.year, fields.month))
    if (e !== null) return err(e)
    days = daysFromCivil(fields.year, fields.month, fields.day)
    const expectedDayOfYear = days - daysFromCivil(fields.year, 1, 1) + 1
    if (fields.dayOfYear !== undefined && fields.dayOfYear !== expectedDayOfYear) {
      return err(
        new InvalidTimeError(
          'dayOfYear',
          fields.dayOfYear,
          `must agree with month/day (expected ${String(expectedDayOfYear)})`,
        ),
      )
    }
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

/** Internal: UTC civil fields already resolved to days/second-of-day → instant, with leap-second validation. */
export function instantFromResolvedUtc(
  resolved: ResolvedCivil,
  options: UtcOptions = {},
): Result<Instant, InvalidTimeError> {
  const table = resolveTable(options)
  const { days, secondOfDay, second, nanosecond } = resolved
  const midnightAfter = (days + 1) * SECONDS_PER_DAY
  if (options.before1972 === 'reject' && days * SECONDS_PER_DAY < UTC_START_UNIX_SECONDS) {
    return err(
      new InvalidTimeError('year', civilFromDays(days).year, 'UTC is undefined before 1972-01-01'),
    )
  }
  if (second === 60) {
    if (secondOfDay !== SECONDS_PER_DAY) {
      return err(new InvalidTimeError('second', 60, 'a leap second can only occur at 23:59:60'))
    }
    const idx = leapEntryIndexForUnix(midnightAfter, table)
    const entry = table.entries[idx]
    const previous = deltaAtIndex(table, idx - 1)
    if (
      entry === undefined ||
      entry.unixSeconds !== midnightAfter ||
      entry.deltaAt !== previous + 1
    ) {
      return err(new InvalidTimeError('second', 60, 'no leap second is inserted at this time'))
    }
    return ok(makeInstant(BigInt(midnightAfter + previous) * NANOS_PER_SECOND + BigInt(nanosecond)))
  }
  const unixSeconds = days * SECONDS_PER_DAY + secondOfDay
  const idx = leapEntryIndexForUnix(unixSeconds, table)
  const delta = deltaAtIndex(table, idx)
  const next = table.entries[idx + 1]
  if (next !== undefined && next.unixSeconds === unixSeconds + 1 && next.deltaAt < delta) {
    return err(
      new InvalidTimeError('second', second, 'this second is deleted by a negative leap second'),
    )
  }
  return ok(makeInstant(BigInt(unixSeconds + delta) * NANOS_PER_SECOND + BigInt(nanosecond)))
}

/**
 * UTC fields → instant. Validates ranges, including that `second: 60` is only
 * accepted at an inserted leap second and that a second deleted by a negative
 * leap second is rejected.
 */
export function instantFromUtc(
  fields: CivilFields,
  options: UtcOptions = {},
): Result<Instant, InvalidTimeError> {
  const resolved = resolveCivilFields(fields)
  return resolved.ok ? instantFromResolvedUtc(resolved.value, options) : resolved
}

/** Breaks an instant into UTC fields. Leap seconds are reported as `second: 60`. */
export function instantToUtc(instant: Instant, options: UtcOptions = {}): CivilDateTime {
  const table = resolveTable(options)
  rejectBefore1972(instant, options)
  const { seconds: taiSeconds, nanos: nanosecond } = splitSeconds(instant.taiNanos)
  const idx = leapEntryIndexForTai(taiSeconds, table)
  const delta = deltaAtIndex(table, idx)
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

/** Internal: seconds on a uniform calendar (no leap seconds) → civil fields. */
export function civilFromUnixSeconds(
  unixSeconds: number,
  nanosecond: number,
  second60 = false,
): CivilDateTime {
  const days = Math.floor(unixSeconds / SECONDS_PER_DAY)
  const secondOfDay = unixSeconds - days * SECONDS_PER_DAY
  const { year, month, day } = civilFromDays(days)
  return {
    year,
    month,
    day,
    dayOfYear: days - daysFromCivil(year, 1, 1) + 1,
    hour: Math.floor(secondOfDay / SECONDS_PER_HOUR),
    minute: Math.floor((secondOfDay % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    second: second60 ? 60 : secondOfDay % SECONDS_PER_MINUTE,
    nanosecond,
  }
}

// ---------------------------------------------------------------------------
// Arithmetic and ordering

/** `instant + d`, exact on the TAI timeline (leap-second safe). */
export const addDuration = (instant: Instant, d: Duration): Instant =>
  makeInstant(instant.taiNanos + d.nanos)
/** `instant − d`, exact on the TAI timeline (leap-second safe). */
export const subtractDuration = (instant: Instant, d: Duration): Instant =>
  makeInstant(instant.taiNanos - d.nanos)
/** `end − start` as an exact elapsed duration (leap seconds included). */
export const durationBetween = (start: Instant, end: Instant): Duration =>
  durationFromNanos(end.taiNanos - start.taiNanos)
/** Total order for `Array.prototype.sort`. */
export const compareInstants = (a: Instant, b: Instant): -1 | 0 | 1 =>
  a.taiNanos < b.taiNanos ? -1 : a.taiNanos > b.taiNanos ? 1 : 0
/** Exact equality (same TAI nanosecond). */
export const instantsEqual = (a: Instant, b: Instant): boolean => a.taiNanos === b.taiNanos
/** `true` when `a` is strictly earlier than `b`. */
export const isBefore = (a: Instant, b: Instant): boolean => a.taiNanos < b.taiNanos
/** `true` when `a` is strictly later than `b`. */
export const isAfter = (a: Instant, b: Instant): boolean => a.taiNanos > b.taiNanos
/** The earlier of two instants. */
export const minInstant = (a: Instant, b: Instant): Instant => (a.taiNanos <= b.taiNanos ? a : b)
/** The later of two instants. */
export const maxInstant = (a: Instant, b: Instant): Instant => (a.taiNanos >= b.taiNanos ? a : b)
/** `instant` limited to the inclusive range [`lo`, `hi`]. */
export const clampInstant = (instant: Instant, lo: Instant, hi: Instant): Instant =>
  instant.taiNanos < lo.taiNanos ? lo : instant.taiNanos > hi.taiNanos ? hi : instant

/**
 * Instants from `start` stepping by `step` (non-zero; negative steps count
 * down) until `end` is reached; `end` is excluded unless `inclusive`.
 */
export function* instantRange(
  start: Instant,
  end: Instant,
  step: Duration,
  options: { readonly inclusive?: boolean | undefined } = {},
): Generator<Instant, void, undefined> {
  if (step.nanos === 0n) throw new RangeError('instantRange step must be non-zero')
  const inclusive = options.inclusive ?? false
  const ascending = step.nanos > 0n
  for (let t = start.taiNanos; ; t += step.nanos) {
    const past = ascending ? t > end.taiNanos : t < end.taiNanos
    const at = t === end.taiNanos
    if (past || (at && !inclusive)) return
    yield makeInstant(t)
  }
}

/** Whether the table's declared expiry has passed at `at` (an instant or Unix seconds). */
export function isLeapSecondTableExpired(table: LeapSecondTable, at: Instant | number): boolean {
  if (table.expires === null) return false
  const unixSeconds =
    typeof at === 'number'
      ? at
      : Number(
          splitSeconds(at.taiNanos - BigInt(deltaAt(at, { leapSeconds: table })) * NANOS_PER_SECOND)
            .seconds,
        )
  return unixSeconds >= table.expires
}
