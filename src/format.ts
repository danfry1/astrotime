import { assertNever } from './assert.js'
import type { Instant, UtcDateTime, UtcOptions } from './instant.js'
import { fractionDigits, pad, tokenize } from './pattern.js'
import { instantToCivil, type TimeScale } from './scales.js'

export type FormatOptions = UtcOptions & {
  /** Scale whose clock reading is formatted. Default `utc`. */
  readonly scale?: TimeScale
}

export type FractionPrecision = 'seconds' | 'millis' | 'micros' | 'nanos' | 'auto'

export type IsoFormatOptions = FormatOptions & {
  /** Fraction digits: 0, 3, 6, 9, or `auto` (shortest of those that is exact). Default `millis`. */
  readonly precision?: FractionPrecision
}

/** Tokens: `YYYY` `MM` `DD` `DDD` `HH` `mm` `ss` `S…S` (1–9 fraction digits) `Z` (literal) `[literal]`. */
export const INSTANT_TOKEN = /^(?:YYYY|MM|DDD|DD|HH|mm|ss|S{1,9}|Z)/

const formatYear = (year: number): string => (year < 0 ? `-${pad(-year, 4)}` : pad(year, 4))

function formatCivil(civil: UtcDateTime, pattern: string): string {
  let out = ''
  for (const token of tokenize(pattern, INSTANT_TOKEN)) {
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
        out += 'Z'
        break
      default:
        out += token.name.repeat(token.width)
    }
  }
  return out
}

/** Formats an instant with a token pattern, e.g. `YYYY-DDDTHH:mm:ss.SSSSSS`. */
export const formatInstant = (
  instant: Instant,
  pattern: string,
  options: FormatOptions = {},
): string => formatCivil(instantToCivil(instant, options.scale ?? 'utc', options), pattern)

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

/** ISO 8601 calendar form, `YYYY-MM-DDTHH:mm:ss[.fff]Z` (the `Z` is omitted for non-UTC scales). */
export function formatIso(instant: Instant, options: IsoFormatOptions = {}): string {
  const scale = options.scale ?? 'utc'
  const civil = instantToCivil(instant, scale, options)
  const fraction = fractionPattern(civil.nanosecond, options.precision ?? 'millis')
  return formatCivil(civil, `YYYY-MM-DD[T]HH:mm:ss${fraction}${scale === 'utc' ? 'Z' : ''}`)
}

/** ISO 8601 ordinal (day-of-year, "SCET") form, `YYYY-DDDTHH:mm:ss[.fff]`. */
export function formatOrdinal(instant: Instant, options: IsoFormatOptions = {}): string {
  const civil = instantToCivil(instant, options.scale ?? 'utc', options)
  const fraction = fractionPattern(civil.nanosecond, options.precision ?? 'millis')
  return formatCivil(civil, `YYYY-DDD[T]HH:mm:ss${fraction}`)
}
