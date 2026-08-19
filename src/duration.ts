import { TimeParseError } from './errors.js'
import { fractionDigits, fractionToNanos, pad, tokenize } from './pattern.js'
import { err, ok, type Result } from './result.js'
import type { StringWithHints } from './types.js'

declare const durationBrand: unique symbol

/**
 * A signed span of elapsed (SI) time in whole nanoseconds.
 * Days are exactly 86 400 s; there are no calendar (month/year) durations.
 */
export type Duration = { readonly nanos: bigint; readonly [durationBrand]: true }

export const NANOS_PER_MICRO = 1_000n
export const NANOS_PER_MILLI = 1_000_000n
export const NANOS_PER_SECOND = 1_000_000_000n
export const NANOS_PER_MINUTE = 60n * NANOS_PER_SECOND
export const NANOS_PER_HOUR = 60n * NANOS_PER_MINUTE
export const NANOS_PER_DAY = 24n * NANOS_PER_HOUR

const makeDuration = (nanos: bigint): Duration => ({ nanos }) as Duration

/** Builds a duration from whole nanoseconds. */
export const durationFromNanos = (nanos: bigint): Duration => makeDuration(nanos)

export const ZERO_DURATION: Duration = makeDuration(0n)

export type DurationParts = {
  readonly days?: number
  readonly hours?: number
  readonly minutes?: number
  readonly seconds?: number
  readonly millis?: number
  readonly micros?: number
  readonly nanos?: number | bigint
}

function scaled(value: number | undefined, unitNanos: bigint, name: string): bigint {
  if (value === undefined) return 0n
  if (!Number.isFinite(value))
    throw new RangeError(`Duration ${name} must be finite, got ${String(value)}`)
  return BigInt(Math.round(value * Number(unitNanos)))
}

/** Builds a duration from components; fractional components are rounded to the nearest nanosecond. */
export function duration(parts: DurationParts): Duration {
  const nanos =
    parts.nanos === undefined
      ? 0n
      : typeof parts.nanos === 'bigint'
        ? parts.nanos
        : scaled(parts.nanos, 1n, 'nanos')
  return makeDuration(
    scaled(parts.days, NANOS_PER_DAY, 'days') +
      scaled(parts.hours, NANOS_PER_HOUR, 'hours') +
      scaled(parts.minutes, NANOS_PER_MINUTE, 'minutes') +
      scaled(parts.seconds, NANOS_PER_SECOND, 'seconds') +
      scaled(parts.millis, NANOS_PER_MILLI, 'millis') +
      scaled(parts.micros, NANOS_PER_MICRO, 'micros') +
      nanos,
  )
}

export const durationFromSeconds = (seconds: number): Duration => duration({ seconds })
export const durationFromMillis = (millis: number): Duration => duration({ millis })

export const durationToNanos = (d: Duration): bigint => d.nanos
/** Seconds as a float; exact below 2^53 ns (~104 days), then rounded. */
export const durationToSeconds = (d: Duration): number => Number(d.nanos) / 1e9
export const durationToMillis = (d: Duration): number => Number(d.nanos) / 1e6

export type DurationComponents = {
  readonly sign: 1 | -1
  readonly days: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
  /** Sub-second remainder in nanoseconds, 0–999 999 999. */
  readonly nanos: number
}

/** Decomposes a duration into non-negative components plus a sign. */
export function durationComponents(d: Duration): DurationComponents {
  const sign: 1 | -1 = d.nanos < 0n ? -1 : 1
  const abs = d.nanos < 0n ? -d.nanos : d.nanos
  return {
    sign,
    days: Number(abs / NANOS_PER_DAY),
    hours: Number((abs % NANOS_PER_DAY) / NANOS_PER_HOUR),
    minutes: Number((abs % NANOS_PER_HOUR) / NANOS_PER_MINUTE),
    seconds: Number((abs % NANOS_PER_MINUTE) / NANOS_PER_SECOND),
    nanos: Number(abs % NANOS_PER_SECOND),
  }
}

export const addDurations = (a: Duration, b: Duration): Duration => makeDuration(a.nanos + b.nanos)
export const subtractDurations = (a: Duration, b: Duration): Duration =>
  makeDuration(a.nanos - b.nanos)
export const negateDuration = (d: Duration): Duration => makeDuration(-d.nanos)
export const absDuration = (d: Duration): Duration => (d.nanos < 0n ? makeDuration(-d.nanos) : d)
/** Multiplies by a number, rounding to the nearest nanosecond. */
export const scaleDuration = (d: Duration, factor: number): Duration => {
  if (!Number.isFinite(factor))
    throw new RangeError(`Duration factor must be finite, got ${String(factor)}`)
  if (Number.isInteger(factor)) return makeDuration(d.nanos * BigInt(factor))
  return makeDuration(BigInt(Math.round(Number(d.nanos) * factor)))
}
export const compareDurations = (a: Duration, b: Duration): -1 | 0 | 1 =>
  a.nanos < b.nanos ? -1 : a.nanos > b.nanos ? 1 : 0
export const durationsEqual = (a: Duration, b: Duration): boolean => a.nanos === b.nanos
export const isNegativeDuration = (d: Duration): boolean => d.nanos < 0n

// ---------------------------------------------------------------------------
// Parsing

const DECIMAL = String.raw`(\d+)(?:[.,](\d{1,9}))?`
const ISO_DURATION = new RegExp(
  `^([+-])?P(?:${DECIMAL}W)?(?:${DECIMAL}D)?(?:T(?=\\d)(?:${DECIMAL}H)?(?:${DECIMAL}M)?(?:${DECIMAL}S)?)?$`,
)
const CLOCK_DURATION = new RegExp(
  String.raw`^([+-])?(?:(\d+)[T ])?(\d+):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?$`,
)

const FORMAT_NAME = 'duration'

function isoComponent(
  whole: string | undefined,
  fraction: string | undefined,
  unitNanos: bigint,
): bigint {
  if (whole === undefined) return 0n
  return BigInt(whole) * unitNanos + fractionToNanos(fraction ?? '', unitNanos)
}

/**
 * Parses a duration string. Accepted forms:
 * - ISO 8601: `P1DT2H3M4.5S`, `PT90M`, `P2W`, with optional leading sign.
 *   Year/month designators are rejected (not fixed-length).
 * - Clock: `HH:mm[:ss[.fraction]]` with optional day prefix `D[T ]`, e.g.
 *   `02:03:04.005`, `36:00:00`, `1T02:03:04`, `-1 12:00:00`.
 */
export function parseDuration(text: string): Result<Duration, TimeParseError> {
  const iso = ISO_DURATION.exec(text)
  if (iso !== null) {
    const [, sign, w, wf, d, df, h, hf, m, mf, s, sf] = iso
    if (
      w === undefined &&
      d === undefined &&
      h === undefined &&
      m === undefined &&
      s === undefined
    ) {
      return err(new TimeParseError(text, 'at least one component is required', FORMAT_NAME))
    }
    const nanos =
      isoComponent(w, wf, 7n * NANOS_PER_DAY) +
      isoComponent(d, df, NANOS_PER_DAY) +
      isoComponent(h, hf, NANOS_PER_HOUR) +
      isoComponent(m, mf, NANOS_PER_MINUTE) +
      isoComponent(s, sf, NANOS_PER_SECOND)
    return ok(makeDuration(sign === '-' ? -nanos : nanos))
  }
  if (/^[+-]?P/.test(text)) {
    const datePart = text.split('T')[0] ?? ''
    const reason = /[YM]/.test(datePart)
      ? 'year and month designators are not supported (not fixed-length)'
      : 'malformed ISO 8601 duration'
    return err(new TimeParseError(text, reason, FORMAT_NAME))
  }
  const clock = CLOCK_DURATION.exec(text)
  if (clock !== null) {
    const [, sign, days, hours, minutes, seconds, fraction] = clock
    if (Number(minutes) > 59)
      return err(new TimeParseError(text, 'minutes must be 0–59', FORMAT_NAME))
    if (seconds !== undefined && Number(seconds) > 59) {
      return err(new TimeParseError(text, 'seconds must be 0–59', FORMAT_NAME))
    }
    const nanos =
      (days === undefined ? 0n : BigInt(days) * NANOS_PER_DAY) +
      BigInt(hours ?? '0') * NANOS_PER_HOUR +
      BigInt(minutes ?? '0') * NANOS_PER_MINUTE +
      (seconds === undefined ? 0n : BigInt(seconds) * NANOS_PER_SECOND) +
      fractionToNanos(fraction ?? '', NANOS_PER_SECOND)
    return ok(makeDuration(sign === '-' ? -nanos : nanos))
  }
  return err(
    new TimeParseError(text, 'expected ISO 8601 (P…T…) or clock (HH:mm:ss) duration', FORMAT_NAME),
  )
}

// ---------------------------------------------------------------------------
// Formatting

const DURATION_TOKEN = /^(?:D+|H{1,2}|m{1,2}|s{1,2}|S{1,9})/

/** Canonical ISO 8601 form, e.g. `P1DT2H3M4.5S`; zero is `PT0S`. */
function formatIsoDuration(d: Duration): string {
  const c = durationComponents(d)
  let out = c.sign < 0 ? '-P' : 'P'
  if (c.days > 0) out += `${String(c.days)}D`
  const time: string[] = []
  if (c.hours > 0) time.push(`${String(c.hours)}H`)
  if (c.minutes > 0) time.push(`${String(c.minutes)}M`)
  if (c.seconds > 0 || c.nanos > 0) {
    const frac = c.nanos > 0 ? `.${String(c.nanos).padStart(9, '0').replace(/0+$/, '')}` : ''
    time.push(`${String(c.seconds)}${frac}S`)
  }
  if (time.length > 0) out += `T${time.join('')}`
  if (c.days === 0 && time.length === 0) out += 'T0S'
  return out
}

/**
 * Formats a duration.
 * - `'iso'` → canonical ISO 8601 (`P1DT2H3M4.5S`).
 * - Token pattern with `D` (days, width = min digits), `HH`/`H`, `mm`/`m`,
 *   `ss`/`s`, `S…S` (fraction digits, truncated) and `[literal]`. The largest
 *   unit present absorbs everything above it: `HH:mm:ss` renders 1.5 days as
 *   `36:00:00`. Negative durations get a leading `-`.
 */
export function formatDuration(d: Duration, pattern: StringWithHints<'iso'> = 'iso'): string {
  if (pattern === 'iso') return formatIsoDuration(d)
  const tokens = tokenize(pattern, DURATION_TOKEN)
  const c = durationComponents(d)
  const present = new Set(tokens.flatMap((t) => (t.kind === 'field' ? [t.name] : [])))
  const largest = present.has('D') ? 'D' : present.has('H') ? 'H' : present.has('m') ? 'm' : 's'
  const hours = largest === 'H' ? c.days * 24 + c.hours : c.hours
  const minutes = largest === 'm' ? (c.days * 24 + c.hours) * 60 + c.minutes : c.minutes
  const seconds =
    largest === 's' ? ((c.days * 24 + c.hours) * 60 + c.minutes) * 60 + c.seconds : c.seconds
  let out = c.sign < 0 ? '-' : ''
  for (const token of tokens) {
    if (token.kind === 'literal') {
      out += token.text
      continue
    }
    switch (token.name) {
      case 'D':
        out += pad(c.days, token.width)
        break
      case 'H':
        out += pad(hours, token.width)
        break
      case 'm':
        out += pad(minutes, token.width)
        break
      case 's':
        out += pad(seconds, token.width)
        break
      case 'S':
        out += fractionDigits(c.nanos, token.width)
        break
      default:
        out += token.name.repeat(token.width)
    }
  }
  return out
}
