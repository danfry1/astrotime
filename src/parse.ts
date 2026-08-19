import { InvalidTimeError, TimeParseError } from './errors.js'
import { INSTANT_TOKEN } from './format.js'
import {
  type Instant,
  instantFromUnixNanos,
  resolveCivilFields,
  type UtcFields,
  type UtcOptions,
} from './instant.js'
import { tokenize } from './pattern.js'
import { civilToInstant, type TimeScale } from './scales.js'
import { err, ok, type Result } from './result.js'
import type { StringWithHints } from './types.js'
import { NANOS_PER_SECOND } from './duration.js'

export type ParseOptions = UtcOptions & {
  /**
   * `'iso'` (default) accepts calendar and ordinal ISO 8601 forms with optional
   * time, fraction (1–9 digits), `Z` or `±HH:mm` offset; `'ordinal'` accepts
   * only the day-of-year form; any other string is a strict token pattern.
   */
  readonly format?: StringWithHints<'iso' | 'ordinal'>
  /** Scale the text is expressed in. Default `utc`. */
  readonly scale?: TimeScale
}

export type ParseError = TimeParseError | InvalidTimeError

const YEAR = String.raw`([+-]?\d{4,6})`
const TIME = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?`
const OFFSET = String.raw`(Z|[+-]\d{2}(?::?\d{2})?)?`
const ISO_CALENDAR = new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})${TIME}${OFFSET}$`)
const ISO_ORDINAL = new RegExp(`^${YEAR}-(\\d{3})${TIME}${OFFSET}$`)
const SECONDS_PER_DAY = 86_400

const parseFraction = (digits: string | undefined): number =>
  digits === undefined ? 0 : Number(digits.padEnd(9, '0'))

function parseOffsetSeconds(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1
  const digits = offset.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
  return sign * (hours * 3600 + minutes * 60)
}

function resolveWithOffset(
  fields: UtcFields,
  offset: string | undefined,
  scale: TimeScale,
  text: string,
  formatName: string,
  options: UtcOptions,
): Result<Instant, ParseError> {
  if (offset === undefined || offset === 'Z' || scale !== 'utc') {
    if (offset !== undefined && scale !== 'utc') {
      return err(
        new TimeParseError(
          text,
          `a UTC designator/offset is not valid for the ${scale.toUpperCase()} scale`,
          formatName,
        ),
      )
    }
    return civilToInstant(fields, scale, options)
  }
  const seconds = parseOffsetSeconds(offset)
  if (seconds === 0) return civilToInstant(fields, 'utc', options)
  if (fields.second === 60) {
    return err(
      new InvalidTimeError(
        'second',
        60,
        'a leap second with a non-zero UTC offset is not supported',
      ),
    )
  }
  const resolved = resolveCivilFields(fields)
  if (!resolved.ok) return resolved
  const unixSeconds = resolved.value.days * SECONDS_PER_DAY + resolved.value.secondOfDay - seconds
  return ok(
    instantFromUnixNanos(
      BigInt(unixSeconds) * NANOS_PER_SECOND + BigInt(resolved.value.nanosecond),
      options,
    ),
  )
}

function parseIsoText(
  text: string,
  ordinalOnly: boolean,
  scale: TimeScale,
  options: UtcOptions,
): Result<Instant, ParseError> {
  const formatName = ordinalOnly ? 'ordinal' : 'iso'
  const ordinal = ISO_ORDINAL.exec(text)
  if (ordinal !== null) {
    const [, year, doy, hour, minute, second, fraction, offset] = ordinal
    const fields: UtcFields = {
      year: Number(year),
      dayOfYear: Number(doy),
      hour: Number(hour ?? 0),
      minute: Number(minute ?? 0),
      second: Number(second ?? 0),
      nanosecond: parseFraction(fraction),
    }
    return resolveWithOffset(fields, offset, scale, text, formatName, options)
  }
  const calendar = ordinalOnly ? null : ISO_CALENDAR.exec(text)
  if (calendar !== null) {
    const [, year, month, day, hour, minute, second, fraction, offset] = calendar
    const fields: UtcFields = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour ?? 0),
      minute: Number(minute ?? 0),
      second: Number(second ?? 0),
      nanosecond: parseFraction(fraction),
    }
    return resolveWithOffset(fields, offset, scale, text, formatName, options)
  }
  const expected = ordinalOnly
    ? 'YYYY-DDD[THH:mm[:ss[.fff]]][Z]'
    : 'YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm]'
  return err(new TimeParseError(text, `expected ${expected}`, formatName))
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

type Compiled = { readonly regex: RegExp; readonly fields: readonly string[] }
const compiledPatterns = new Map<string, Compiled>()

function compilePattern(pattern: string): Compiled {
  const cached = compiledPatterns.get(pattern)
  if (cached !== undefined) return cached
  let source = '^'
  const fields: string[] = []
  for (const token of tokenize(pattern, INSTANT_TOKEN)) {
    if (token.kind === 'literal') {
      source += escapeRegExp(token.text)
      continue
    }
    if (token.name === 'Z') {
      source += 'Z'
      continue
    }
    const width =
      token.name === 'Y'
        ? 4
        : token.name === 'D'
          ? token.width
          : token.name === 'S'
            ? token.width
            : 2
    source += token.name === 'Y' ? String.raw`([+-]?\d{4,6})` : `(\\d{${String(width)}})`
    fields.push(token.name === 'D' ? (token.width === 3 ? 'doy' : 'D') : token.name)
  }
  const compiled = { regex: new RegExp(`${source}$`), fields }
  compiledPatterns.set(pattern, compiled)
  return compiled
}

function parseWithPattern(
  text: string,
  pattern: string,
  scale: TimeScale,
  options: UtcOptions,
): Result<Instant, ParseError> {
  const { regex, fields } = compilePattern(pattern)
  const match = regex.exec(text)
  if (match === null)
    return err(new TimeParseError(text, `does not match pattern ${pattern}`, pattern))
  const values: Partial<Record<string, string>> = {}
  fields.forEach((name, i) => {
    values[name] = match[i + 1]
  })
  const year = values['Y']
  if (year === undefined)
    return err(new TimeParseError(text, 'pattern must include a year (YYYY)', pattern))
  const time = {
    hour: Number(values['H'] ?? 0),
    minute: Number(values['m'] ?? 0),
    second: Number(values['s'] ?? 0),
    nanosecond: parseFraction(values['S']),
  }
  const doy = values['doy']
  const utcFields: UtcFields =
    doy !== undefined
      ? { year: Number(year), dayOfYear: Number(doy), ...time }
      : {
          year: Number(year),
          month: Number(values['M'] ?? 1),
          day: Number(values['D'] ?? 1),
          ...time,
        }
  return civilToInstant(utcFields, scale, options)
}

/** Parses text into an instant. See `ParseOptions.format` for accepted forms. */
export function parseInstant(
  text: string,
  options: ParseOptions = {},
): Result<Instant, ParseError> {
  const scale = options.scale ?? 'utc'
  const format = options.format ?? 'iso'
  if (format === 'iso') return parseIsoText(text, false, scale, options)
  if (format === 'ordinal') return parseIsoText(text, true, scale, options)
  return parseWithPattern(text, format, scale, options)
}

/** `true` when `text` parses under the given options. */
export const isValidInstant = (text: string, options?: ParseOptions): boolean =>
  parseInstant(text, options).ok
