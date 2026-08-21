import { assertNever } from './assert.js'
import type { CivilDateTime, Instant, UtcOptions } from './instant.js'
import { fractionDigits, pad, tokenCache, unknownTokensIn } from './pattern.js'
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

const rawInstantTokens = tokenCache(INSTANT_TOKEN)
const checkedPatterns = new Set<string>()

/** Tokenises, rejecting a pattern whose stray letters would be rendered verbatim. */
function instantTokens(pattern: string): ReturnType<typeof rawInstantTokens> {
  if (!checkedPatterns.has(pattern)) {
    const unknown = unknownFormatTokens(pattern)
    if (unknown.length > 0) {
      throw new RangeError(
        `Format pattern ${JSON.stringify(pattern)} contains unknown token(s) ${unknown
          .map((t) => JSON.stringify(t))
          .join(', ')}. Use [text] for a literal, or isValidFormatPattern() to check first.`,
      )
    }
    checkedPatterns.add(pattern)
  }
  return rawInstantTokens(pattern)
}

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
 * Letters in `pattern` that are neither part of a known token nor inside a
 * `[literal]` block, in order of appearance and without duplicates.
 *
 * Unknown letters are rendered verbatim, so a mistyped pattern produces
 * plausible but wrong output rather than an error: `'HH:mm:ss.ms'` yields
 * `'12:34:56.ms'`. Call this when the pattern comes from configuration or a
 * user, or in a test, to turn that silent failure into a visible one.
 *
 * @example
 * unknownFormatTokens('YYYY-MM-DD HH:mm:ss.SSS') // []
 * unknownFormatTokens('YYYY-MM-DD hh:mm:ss.ms')  // ['hh', 'ms']
 */
export const unknownFormatTokens = (pattern: string): readonly string[] =>
  unknownTokensIn(pattern, INSTANT_TOKEN)

/** `true` when every letter in `pattern` belongs to a known token or a `[literal]` block. */
export const isValidFormatPattern = (pattern: string): boolean =>
  unknownFormatTokens(pattern).length === 0

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
