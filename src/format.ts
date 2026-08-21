import { assertNever } from './assert.js'
import type { CivilDateTime, Instant, UtcOptions } from './instant.js'
import {
  fractionDigits,
  type FieldKey,
  pad,
  patternProblem,
  validatedTokenCache,
} from './pattern.js'
import { instantToCivil, TIME_SCALE_LABELS, type TimeScale } from './scales.js'

export type FormatOptions = UtcOptions & {
  /** Scale whose clock reading is formatted. Default `utc`. */
  readonly scale?: TimeScale | undefined
}

export type FractionPrecision = 'seconds' | 'millis' | 'micros' | 'nanos' | 'auto'

export type IsoFormatOptions = FormatOptions & {
  /** Fraction digits: 0, 3, 6, 9, or `auto` (shortest of those that is exact). Default `millis`. */
  readonly precision?: FractionPrecision | undefined
  /**
   * Trailing designator. `'auto'` (default) appends `Z` for UTC and ` TAI` /
   * ` TT` / ` GPS` / ` TDB` for other scales so the string is never ambiguous;
   * `'none'` appends nothing.
   */
  readonly designator?: 'auto' | 'none' | undefined
}

/**
 * Field tokens: `YYYY` `MM` `DD` `DDD` `HH` `mm` `ss` `S…S` (1–9 fraction
 * digits, truncated) and `Z` (scale designator: `Z` for UTC, otherwise `TAI`,
 * `TT`, `GPS` or `TDB`). `[text]` is a literal; other characters pass through.
 */
export const INSTANT_TOKEN = /^(?:YYYY|MM|DDD|DD|HH|mm|ss|S{1,9}|Z)/

/**
 * `DD` (day of the month) and `DDD` (day of the year) are different fields
 * that share a letter, so both may appear in one pattern; every other letter
 * names a single field whatever its width.
 */
const instantFieldKey: FieldKey = (name, width) => (name === 'D' ? `D${String(width)}` : name)

const describeInstantProblem = (pattern: string, problem: string): string =>
  `Format pattern ${JSON.stringify(pattern)} is invalid: ${problem}. ` +
  `Use [text] for a literal, or formatPatternError() to check a pattern first.`

const instantTokens = validatedTokenCache(INSTANT_TOKEN, instantFieldKey, describeInstantProblem)

/**
 * ISO 8601 year: 4 digits, or an expanded sign+6-digit form outside
 * 0000–9999. Throws `RangeError` beyond the supported ±999 999 civil range
 * rather than emitting a string that cannot round-trip.
 */
const formatYear = (year: number): string => {
  if (year < -999_999 || year > 999_999) {
    throw new RangeError(`Year ${String(year)} is outside the supported civil range (±999999)`)
  }
  if (year > 9999) return `+${pad(year, 6)}`
  if (year < -9999) return `-${pad(-year, 6)}`
  return year < 0 ? `-${pad(-year, 4)}` : pad(year, 4)
}

const scaleDesignator = (scale: TimeScale): string =>
  scale === 'utc' ? 'Z' : TIME_SCALE_LABELS[scale]

function formatCivil(civil: CivilDateTime, pattern: string, scale: TimeScale): string {
  let out = ''
  for (const token of instantTokens(pattern)) {
    if (token.kind === 'literal') {
      out += token.text
      continue
    }
    switch (token.name) {
      case 'Y':
        out += formatYear(civil.year)
        break
      case 'M':
        out += pad(civil.month, 2)
        break
      case 'D':
        out += token.width === 3 ? pad(civil.dayOfYear, 3) : pad(civil.day, 2)
        break
      case 'H':
        out += pad(civil.hour, 2)
        break
      case 'm':
        out += pad(civil.minute, 2)
        break
      case 's':
        out += pad(civil.second, 2)
        break
      case 'S':
        out += fractionDigits(civil.nanosecond, token.width)
        break
      case 'Z':
        out += scaleDesignator(scale)
        break
      default:
        out += token.name.repeat(token.width)
    }
  }
  return out
}

/**
 * Explains why `pattern` is not a usable format pattern, or `null` when it
 * is. `formatInstant` throws on exactly these patterns, so this is the
 * check-first alternative for a pattern that arrives from configuration or
 * a user rather than from source.
 *
 * @example
 * formatPatternError('YYYY-MM-DD HH:mm:ss.SSS') // null
 * formatPatternError('YYYY-MM-DD hh:mm:ss.ms')  // 'unknown token(s) "hh", "ms"'
 * formatPatternError('YYYY-MM-DDTHH:mm:ss')     // 'unknown token(s) "T"'
 * formatPatternError('HH:mm:ss.SSSSSSSSSS')     // '"SSSSSSSSSS" is longer than …'
 * formatPatternError('YYYY [')                  // 'unterminated "[" at position 5 …'
 */
export const formatPatternError = (pattern: string): string | null =>
  patternProblem(pattern, INSTANT_TOKEN, instantFieldKey)

/** `true` when `formatInstant` accepts `pattern`. */
export const isValidFormatPattern = (pattern: string): boolean =>
  formatPatternError(pattern) === null

/** Internal: throws the same `RangeError` `formatInstant` would, for the parser to share. */
export function assertInstantPattern(pattern: string): void {
  const problem = formatPatternError(pattern)
  if (problem !== null) throw new RangeError(describeInstantProblem(pattern, problem))
}

/** Formats an instant with a token pattern, e.g. `YYYY-DDDTHH:mm:ss.SSSSSS`. */
export function formatInstant(
  instant: Instant,
  pattern: string,
  options: FormatOptions = {},
): string {
  const scale = options.scale ?? 'utc'
  return formatCivil(instantToCivil(instant, scale, options), pattern, scale)
}

function fractionPattern(nanosecond: number, precision: FractionPrecision): string {
  switch (precision) {
    case 'seconds':
      return ''
    case 'millis':
      return '.SSS'
    case 'micros':
      return '.SSSSSS'
    case 'nanos':
      return '.SSSSSSSSS'
    case 'auto':
      if (nanosecond === 0) return ''
      if (nanosecond % 1_000_000 === 0) return '.SSS'
      if (nanosecond % 1_000 === 0) return '.SSSSSS'
      return '.SSSSSSSSS'
    default:
      return assertNever(precision)
  }
}

const designatorPattern = (scale: TimeScale, designator: 'auto' | 'none'): string =>
  designator === 'none' ? '' : scale === 'utc' ? 'Z' : ' Z'

/** ISO 8601 calendar form, `YYYY-MM-DDTHH:mm:ss[.fff]Z` (`… TAI` etc. for other scales). */
export function formatIso(instant: Instant, options: IsoFormatOptions = {}): string {
  const scale = options.scale ?? 'utc'
  const civil = instantToCivil(instant, scale, options)
  const fraction = fractionPattern(civil.nanosecond, options.precision ?? 'millis')
  return formatCivil(
    civil,
    `YYYY-MM-DD[T]HH:mm:ss${fraction}${designatorPattern(scale, options.designator ?? 'auto')}`,
    scale,
  )
}

/** ISO 8601 ordinal (day-of-year, "SCET") form, `YYYY-DDDTHH:mm:ss[.fff]` (designator only for non-UTC scales by default). */
export function formatOrdinal(instant: Instant, options: IsoFormatOptions = {}): string {
  const scale = options.scale ?? 'utc'
  const civil = instantToCivil(instant, scale, options)
  const fraction = fractionPattern(civil.nanosecond, options.precision ?? 'millis')
  const designator = options.designator ?? 'auto'
  const suffix = designator === 'none' || scale === 'utc' ? '' : ' Z'
  return formatCivil(civil, `YYYY-DDD[T]HH:mm:ss${fraction}${suffix}`, scale)
}
