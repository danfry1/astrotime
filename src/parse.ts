import { daysFromCivil } from './calendar.js'
import { NANOS_PER_SECOND } from './duration.js'
import { InvalidTimeError, TimeParseError } from './errors.js'
import { formatPatternError, INSTANT_TOKEN } from './format.js'
import {
  type CivilDateTime,
  type CivilFields,
  civilFromUnixSeconds,
  type Instant,
  instantFromResolvedUtc,
  resolveCivilFields,
  type UtcOptions,
} from './instant.js'
import { PRE_1972_DELTA_AT } from './leap-seconds.js'
import { assertOptionsObject } from './options.js'
import { fractionDigits, pad, tokenize } from './pattern.js'
import { assertTimeScale, instantFromCivil, TIME_SCALE_LABELS, type TimeScale } from './scales.js'
import { err, ok, type Result, unwrap } from './result.js'
import type { StringWithHints } from './types.js'

export type ParseOptions = UtcOptions & {
  /**
   * `'iso'` (default) accepts calendar and ordinal ISO 8601 extended forms
   * with optional time, fraction (1–9 digits) and designator (`Z`, `±HH` or
   * `±HH:mm`, or ` TAI` / ` TT` / ` GPS` / ` TDB`); `'ordinal'` accepts only
   * the day-of-year form; any other string is a strict token pattern (see
   * `INSTANT_TOKEN`). The year is four digits, optionally negative, or a sign
   * and six digits (the expanded form the formatter writes). `Z` and UTC
   * offsets need a time of day, as in ISO 8601; a scale label may follow a
   * bare date (`2017-01-01 TAI` is midnight on the TAI clock), and its space
   * is optional so the `Z` token's output (`…:37TAI`) reads back. The parsed
   * instant must have a UTC reading and a TAI serialization inside the
   * supported ±999 999-year civil range.
   */
  readonly format?: StringWithHints<'iso' | 'ordinal'> | undefined
  /**
   * Scale the text is expressed in. Default `utc`. A scale designator in the
   * text must agree with it; when `scale` is omitted the designator wins.
   */
  readonly scale?: TimeScale | undefined
}

export type ParseError = TimeParseError | InvalidTimeError

const YEAR = String.raw`([+-]\d{6}|-?\d{4})`
const TIME = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?`
const DESIGNATOR = String.raw`(Z|[+-]\d{2}(?::\d{2})?| ?(?:TAI|TT|GPS|TDB))?`
const ISO_CALENDAR = new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})${TIME}${DESIGNATOR}$`)
const ISO_ORDINAL = new RegExp(`^${YEAR}-(\\d{3})${TIME}${DESIGNATOR}$`)
const SECONDS_PER_DAY = 86_400
// The supported civil range bounds both the UTC reading (formatIso) and the
// TAI serialization (toJSON / String). Before 1972 UTC trails TAI by a fixed
// PRE_1972_DELTA_AT, and it still trails TAI at the far end, so the UTC
// reading sets the lower bound and the TAI reading the upper one.
const FIRST_SUPPORTED_TAI_NANOS =
  BigInt(daysFromCivil(-999_999, 1, 1) * SECONDS_PER_DAY + PRE_1972_DELTA_AT) * NANOS_PER_SECOND
const END_SUPPORTED_TAI_NANOS =
  BigInt(daysFromCivil(1_000_000, 1, 1) * SECONDS_PER_DAY) * NANOS_PER_SECOND
const LABEL_TO_SCALE: Readonly<Record<string, TimeScale>> = {
  TAI: 'tai',
  TT: 'tt',
  GPS: 'gps',
  TDB: 'tdb',
}

const parseFraction = (digits: string | undefined): number =>
  digits === undefined ? 0 : Number(digits.padEnd(9, '0'))

function parseYear(text: string): number | null {
  if (/^-0+$/.test(text)) return null
  return Number(text)
}

type Designator =
  | { readonly kind: 'none' }
  | { readonly kind: 'offset'; readonly seconds: number }
  | { readonly kind: 'scale'; readonly scale: TimeScale }

function parseDesignator(
  raw: string | undefined,
  text: string,
  formatName: string,
): Result<Designator, TimeParseError> {
  if (raw === undefined) return ok({ kind: 'none' })
  if (raw === 'Z') return ok({ kind: 'scale', scale: 'utc' })
  const label = raw.trim()
  const scale = LABEL_TO_SCALE[label]
  if (scale !== undefined) return ok({ kind: 'scale', scale })
  const sign = raw.startsWith('-') ? -1 : 1
  const digits = raw.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0
  if (hours > 23 || minutes > 59)
    return err(new TimeParseError(text, `invalid UTC offset ${raw}`, formatName))
  return ok({ kind: 'offset', seconds: sign * (hours * 3600 + minutes * 60) })
}

function resolveScale(
  designator: Designator,
  requested: TimeScale | undefined,
  text: string,
  formatName: string,
): Result<TimeScale, TimeParseError> {
  if (designator.kind === 'scale') {
    if (requested !== undefined && requested !== designator.scale) {
      return err(
        new TimeParseError(
          text,
          `text is in ${TIME_SCALE_LABELS[designator.scale]} but ${TIME_SCALE_LABELS[requested]} was requested`,
          formatName,
        ),
      )
    }
    return ok(designator.scale)
  }
  const scale = requested ?? 'utc'
  if (designator.kind === 'offset' && scale !== 'utc') {
    return err(
      new TimeParseError(
        text,
        `a UTC offset is not valid for the ${TIME_SCALE_LABELS[scale]} scale`,
        formatName,
      ),
    )
  }
  return ok(scale)
}

/** A UTC reading for an error message, including the out-of-range years an offset can reach. */
function describeUtc(c: CivilDateTime): string {
  const magnitude = Math.abs(c.year)
  const sign = c.year < 0 ? '-' : magnitude > 9999 ? '+' : ''
  const fraction =
    c.nanosecond === 0 ? '' : `.${fractionDigits(c.nanosecond, 9).replace(/0+$/, '')}`
  return (
    `${sign}${pad(magnitude, magnitude > 9999 ? 6 : 4)}-${pad(c.month, 2)}-${pad(c.day, 2)}` +
    `T${pad(c.hour, 2)}:${pad(c.minute, 2)}:${pad(c.second, 2)}${fraction} UTC`
  )
}

/**
 * Text carrying a non-zero UTC offset → instant. Every check runs on the UTC
 * reading, so a failure names that reading: otherwise `23:59:60+01:00` would
 * be told that a leap second can only occur at 23:59:60.
 */
function resolveOffset(
  fields: CivilFields,
  offsetSeconds: number,
  text: string,
  options: UtcOptions,
): Result<Instant, InvalidTimeError> {
  const resolved = resolveCivilFields(fields)
  if (!resolved.ok) return resolved
  const { days, secondOfDay, second, nanosecond } = resolved.value
  // For a leap second, secondOfDay includes the `:60` and so denotes the
  // following local clock boundary. Shift that boundary to UTC and step back
  // into its preceding civil minute; the ordinary UTC constructor then
  // verifies that this is an actual positive leap boundary.
  const leap = second === 60 ? 1 : 0
  const utc = civilFromUnixSeconds(
    days * SECONDS_PER_DAY + secondOfDay - offsetSeconds - leap,
    nanosecond,
    leap === 1,
  )
  const shifted = resolveCivilFields({
    year: utc.year,
    month: utc.month,
    day: utc.day,
    hour: utc.hour,
    minute: utc.minute,
    second: utc.second,
    nanosecond: utc.nanosecond,
  })
  const instant = shifted.ok ? instantFromResolvedUtc(shifted.value, options) : shifted
  if (instant.ok) return instant
  const { field, value, reason } = instant.error
  return err(new InvalidTimeError(field, value, `${text} is ${describeUtc(utc)}; ${reason}`))
}

/**
 * Rejects an instant that the library could not then render: `formatIso`
 * and the TAI serialization both throw outside the civil range, so a parser
 * that accepted it would hand back a value its own formatters refuse. Only
 * a scale offset of seconds can carry in-range text past a bound (offset
 * text is range-checked on its UTC reading first), so the out-of-range year
 * is always the adjacent ±1 000 000.
 */
function checkCivilRange(instant: Instant, text: string): Result<Instant, InvalidTimeError> {
  if (instant.taiNanos < FIRST_SUPPORTED_TAI_NANOS) {
    return err(
      new InvalidTimeError(
        'year',
        -1_000_000,
        `${text} is before -999999-01-01T00:00:00 UTC, the start of the supported civil range`,
      ),
    )
  }
  if (instant.taiNanos >= END_SUPPORTED_TAI_NANOS) {
    return err(
      new InvalidTimeError(
        'year',
        1_000_000,
        `${text} is after +999999-12-31T23:59:59.999999999 TAI, the end of the supported civil range`,
      ),
    )
  }
  return ok(instant)
}

function resolveFields(
  fields: CivilFields,
  designator: Designator,
  requested: TimeScale | undefined,
  text: string,
  formatName: string,
  options: UtcOptions,
): Result<Instant, ParseError> {
  const scale = resolveScale(designator, requested, text, formatName)
  if (!scale.ok) return scale
  const instant =
    designator.kind === 'offset' && designator.seconds !== 0
      ? resolveOffset(fields, designator.seconds, text, options)
      : instantFromCivil(fields, scale.value, options)
  return instant.ok ? checkCivilRange(instant.value, text) : instant
}

/**
 * ISO 8601 attaches `Z` and UTC offsets to a time of day, never to a bare
 * date. A scale label names the clock a date is read on, which an
 * astronomical date (`2017-01-01 TAI`) legitimately carries.
 */
function parseIsoDesignator(
  raw: string | undefined,
  hasTime: boolean,
  text: string,
  formatName: string,
): Result<Designator, TimeParseError> {
  if (!hasTime && raw !== undefined && (raw === 'Z' || raw.startsWith('+') || raw.startsWith('-')))
    return err(
      new TimeParseError(
        text,
        `${raw} needs a time of day; ISO 8601 has no UTC offset on a date alone`,
        formatName,
      ),
    )
  return parseDesignator(raw, text, formatName)
}

function parseIsoText(
  text: string,
  ordinalOnly: boolean,
  requested: TimeScale | undefined,
  options: UtcOptions,
): Result<Instant, ParseError> {
  const formatName = ordinalOnly ? 'ordinal' : 'iso'
  const ordinal = ISO_ORDINAL.exec(text)
  const calendar = ordinal === null && !ordinalOnly ? ISO_CALENDAR.exec(text) : null
  const match = ordinal ?? calendar
  if (match === null) {
    const expected = ordinalOnly
      ? 'YYYY-DDD[THH:mm[:ss[.fff]]][Z|±HH:mm| TAI]'
      : 'YYYY-MM-DD or YYYY-DDD with optional THH:mm[:ss[.fff]][Z|±HH:mm| TAI]'
    return err(new TimeParseError(text, `expected ${expected}`, formatName))
  }
  const year = parseYear(match[1] ?? '')
  if (year === null)
    return err(new TimeParseError(text, 'negative-zero years are not allowed', formatName))
  const timeOffset = ordinal !== null ? 3 : 4
  const designator = parseIsoDesignator(
    match.at(-1),
    match[timeOffset] !== undefined,
    text,
    formatName,
  )
  if (!designator.ok) return designator
  const time = {
    hour: Number(match[timeOffset] ?? 0),
    minute: Number(match[timeOffset + 1] ?? 0),
    second: Number(match[timeOffset + 2] ?? 0),
    nanosecond: parseFraction(match[timeOffset + 3]),
  }
  const fields: CivilFields =
    ordinal !== null
      ? { year, dayOfYear: Number(ordinal[2]), ...time }
      : { year, month: Number(match[2]), day: Number(match[3]), ...time }
  return resolveFields(fields, designator.value, requested, text, formatName, options)
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

type Compiled = { readonly regex: RegExp; readonly fields: readonly string[] }
const compiledPatterns = new Map<string, Compiled>()
const MAX_COMPILED_PATTERNS = 256

/**
 * Field codes from largest to smallest unit below the year, with the token
 * that reads each and how to name it when missing (DDD can supply the day).
 */
const FIELD_CHAIN = [
  ['M', 'MM', 'MM'],
  ['D', 'DD', 'DD or DDD'],
  ['H', 'HH', 'HH'],
  ['m', 'mm', 'mm'],
  ['s', 'ss', 'ss'],
  ['S', 'S…S', 'S…S'],
] as const

/**
 * A pattern may stop early ('YYYY-MM' reads the first of the month, as ISO
 * reduced precision does), but a field read below a missing one would be
 * placed by a default the text never stated: 'YYYY DD' would read "2026 19"
 * as 19 January, and 'HH ss' would put every second in minute zero.
 */
function gapProblem(fields: readonly string[]): string | null {
  const ordinal = fields.includes('doy')
  let missing: string | null = null
  for (const [code, token, missingName] of FIELD_CHAIN) {
    if (fields.includes(code) || (ordinal && (code === 'M' || code === 'D'))) {
      if (missing !== null) return `reads ${token} without ${missing}, which would silently default`
    } else {
      missing = missingName
    }
  }
  return null
}

/**
 * Why `fields` cannot read a date, or `null`. Parsing asks more of a pattern
 * than formatting does: formatting only has to render whatever fields are
 * present, while parsing has to reconstruct a whole instant from them.
 */
function fieldsProblem(fields: readonly string[]): string | null {
  if (!fields.includes('Y')) return 'no year (YYYY), so it cannot identify a date'
  if (!fields.includes('doy')) return gapProblem(fields)
  const hasMonth = fields.includes('M')
  const hasDay = fields.includes('D')
  if (hasMonth === hasDay) return gapProblem(fields)
  // With DDD and only one of MM/DD there is no complete calendar date to
  // check the ordinal one against, and silently dropping the field it does
  // have would make 'YYYY-MM DDD' ignore the month it was given.
  return `combines DDD with ${hasMonth ? 'MM but not DD' : 'DD but not MM'}, which names no date it can check`
}

/** Field codes a pattern reads, in order: 'Y' 'M' 'D' 'doy' 'H' 'm' 's' 'S' 'Z'. */
function patternFields(pattern: string): readonly string[] {
  const fields: string[] = []
  for (const token of tokenize(pattern, INSTANT_TOKEN)) {
    if (token.kind !== 'field') continue
    if (token.name === 'D') fields.push(token.width === 3 ? 'doy' : 'D')
    else fields.push(token.name)
  }
  return fields
}

/**
 * Explains why `pattern` cannot be used to parse, or `null` when it can.
 * Distinct from `formatPatternError` because the two directions differ:
 * `'HH:mm'` is a perfectly good pattern to *render* and cannot name an
 * instant to *read*.
 *
 * @example
 * parsePatternError('YYYY-MM-DD HH:mm') // null
 * parsePatternError('HH:mm')            // 'no year (YYYY), so it cannot identify a date'
 * parsePatternError('YYYY-MM DDD')      // 'combines DDD with MM but not DD, …'
 * parsePatternError('YYYY DD')          // 'reads DD without MM, which would silently default'
 */
export function parsePatternError(pattern: string): string | null {
  if (pattern === 'iso' || pattern === 'ordinal') return null
  return formatPatternError(pattern) ?? fieldsProblem(patternFields(pattern))
}

const describeParseProblem = (pattern: string, problem: string): string =>
  `Parse pattern ${JSON.stringify(pattern)} is invalid: ${problem}. ` +
  `Use [text] for a literal, or parsePatternError() to check a pattern first.`

function compilePattern(pattern: string): Compiled {
  const cached = compiledPatterns.get(pattern)
  if (cached !== undefined) return cached
  // A defect in the pattern is a defect in the caller's source, not in the
  // text being parsed; reporting it as a parse failure would blame the data.
  const problem = parsePatternError(pattern)
  if (problem !== null) throw new RangeError(describeParseProblem(pattern, problem))
  let source = '^'
  const fields: string[] = []
  for (const token of tokenize(pattern, INSTANT_TOKEN)) {
    if (token.kind === 'literal') {
      source += escapeRegExp(token.text)
      continue
    }
    switch (token.name) {
      case 'Y':
        // Fixed widths keep adjacent digit tokens unambiguous: an expanded
        // year is exactly a sign plus six digits (as the formatter emits).
        source += String.raw`([+-]\d{6}|-?\d{4})`
        fields.push('Y')
        break
      case 'Z':
        source += String.raw`(Z|TAI|TT|GPS|TDB)`
        fields.push('Z')
        break
      case 'D':
        source += `(\\d{${String(token.width)}})`
        fields.push(token.width === 3 ? 'doy' : 'D')
        break
      case 'S':
        source += `(\\d{${String(token.width)}})`
        fields.push('S')
        break
      default:
        source += String.raw`(\d{2})`
        fields.push(token.name)
    }
  }
  const compiled = { regex: new RegExp(`${source}$`), fields }
  if (compiledPatterns.size >= MAX_COMPILED_PATTERNS) compiledPatterns.clear()
  compiledPatterns.set(pattern, compiled)
  return compiled
}

function parseWithPattern(
  text: string,
  pattern: string,
  requested: TimeScale | undefined,
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
  // compilePattern guarantees a year field, so the capture is always present.
  const rawYear = values['Y'] ?? ''
  const year = parseYear(rawYear)
  if (year === null)
    return err(new TimeParseError(text, 'negative-zero years are not allowed', pattern))
  const designator = parseDesignator(values['Z'], text, pattern)
  if (!designator.ok) return designator
  const time = {
    hour: Number(values['H'] ?? 0),
    minute: Number(values['m'] ?? 0),
    second: Number(values['s'] ?? 0),
    nanosecond: parseFraction(values['S']),
  }
  // compilePattern rejects DDD alongside only one of MM/DD, so either the
  // calendar date is complete or there is none and the ordinal one stands.
  const doy = values['doy']
  const month = values['M']
  const day = values['D']
  const civil: CivilFields =
    doy !== undefined && month === undefined && day === undefined
      ? { year, dayOfYear: Number(doy), ...time }
      : {
          year,
          month: Number(month ?? 1),
          day: Number(day ?? 1),
          // A pattern carrying DD and DDD must agree on the date it names.
          ...(doy === undefined ? {} : { dayOfYear: Number(doy) }),
          ...time,
        }
  return resolveFields(civil, designator.value, requested, text, pattern, options)
}

/** Parses text into an instant. See `ParseOptions.format` for accepted forms. */
export function parseInstant(
  text: string,
  options: ParseOptions = {},
): Result<Instant, ParseError> {
  assertOptionsObject(options, 'parseInstant', true)
  if (options.scale !== undefined) assertTimeScale(options.scale)
  let format: unknown = 'iso'
  if (options.format !== undefined) format = options.format
  if (typeof format !== 'string') {
    throw new RangeError(`parseInstant format must be a string, got ${String(format)}`)
  }
  if (format === 'iso') return parseIsoText(text, false, options.scale, options)
  if (format === 'ordinal') return parseIsoText(text, true, options.scale, options)
  return parseWithPattern(text, format, options.scale, options)
}

/** `parseInstant` that throws the `TimeParseError` / `InvalidTimeError` instead of returning it. */
export const parseInstantOrThrow = (text: string, options?: ParseOptions): Instant =>
  unwrap(parseInstant(text, options))

/** `true` when `text` parses under the given options. */
export const isValidInstant = (text: string, options?: ParseOptions): boolean =>
  parseInstant(text, options).ok
