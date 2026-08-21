import { InvalidTimeError, TimeParseError } from './errors.js'
import { formatPatternError, INSTANT_TOKEN } from './format.js'
import {
  type CivilFields,
  civilFromUnixSeconds,
  type Instant,
  instantFromResolvedUtc,
  resolveCivilFields,
  type UtcOptions,
} from './instant.js'
import { tokenize } from './pattern.js'
import { instantFromCivil, TIME_SCALE_LABELS, type TimeScale } from './scales.js'
import { err, ok, type Result, unwrap } from './result.js'
import type { StringWithHints } from './types.js'

export type ParseOptions = UtcOptions & {
  /**
   * `'iso'` (default) accepts calendar and ordinal ISO 8601 forms with optional
   * time, fraction (1–9 digits) and designator (`Z`, `±HH[:mm]`, or ` TAI` /
   * ` TT` / ` GPS` / ` TDB`); `'ordinal'` accepts only the day-of-year form;
   * any other string is a strict token pattern (see `INSTANT_TOKEN`).
   */
  readonly format?: StringWithHints<'iso' | 'ordinal'> | undefined
  /**
   * Scale the text is expressed in. Default `utc`. A scale designator in the
   * text must agree with it; when `scale` is omitted the designator wins.
   */
  readonly scale?: TimeScale | undefined
}

export type ParseError = TimeParseError | InvalidTimeError

const YEAR = String.raw`([+-]\d{4,6}|\d{4})`
const TIME = String.raw`(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?`
const DESIGNATOR = String.raw`(Z|[+-]\d{2}(?::?\d{2})?| ?(?:TAI|TT|GPS|TDB))?`
const ISO_CALENDAR = new RegExp(`^${YEAR}-(\\d{2})-(\\d{2})${TIME}${DESIGNATOR}$`)
const ISO_ORDINAL = new RegExp(`^${YEAR}-(\\d{3})${TIME}${DESIGNATOR}$`)
const SECONDS_PER_DAY = 86_400
const LABEL_TO_SCALE: Readonly<Record<string, TimeScale>> = {
  TAI: 'tai',
  TT: 'tt',
  GPS: 'gps',
  TDB: 'tdb',
}

const parseFraction = (digits: string | undefined): number =>
  digits === undefined ? 0 : Number(digits.padEnd(9, '0'))

function parseYear(text: string): number | null {
  if (text === '-0000') return null
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
  if (designator.kind !== 'offset' || designator.seconds === 0)
    return instantFromCivil(fields, scale.value, options)
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
  // Shift to UTC, then re-derive civil fields so leap-second validation applies to the UTC reading.
  const unixSeconds =
    resolved.value.days * SECONDS_PER_DAY + resolved.value.secondOfDay - designator.seconds
  const utc = civilFromUnixSeconds(unixSeconds, resolved.value.nanosecond)
  const shifted = resolveCivilFields({
    year: utc.year,
    month: utc.month,
    day: utc.day,
    hour: utc.hour,
    minute: utc.minute,
    second: utc.second,
    nanosecond: utc.nanosecond,
  })
  if (!shifted.ok) return shifted
  return instantFromResolvedUtc(shifted.value, options)
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
  if (year === null) return err(new TimeParseError(text, 'year -0000 is not allowed', formatName))
  const designator = parseDesignator(match.at(-1), text, formatName)
  if (!designator.ok) return designator
  const timeOffset = ordinal !== null ? 3 : 4
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
 * Why `fields` cannot read a date, or `null`. Parsing asks more of a pattern
 * than formatting does: formatting only has to render whatever fields are
 * present, while parsing has to reconstruct a whole instant from them.
 */
function fieldsProblem(fields: readonly string[]): string | null {
  if (!fields.includes('Y')) return 'no year (YYYY), so it cannot identify a date'
  if (!fields.includes('doy')) return null
  const hasMonth = fields.includes('M')
  const hasDay = fields.includes('D')
  if (hasMonth === hasDay) return null
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
  const year = values['Y'] ?? ''
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
      ? { year: Number(year), dayOfYear: Number(doy), ...time }
      : {
          year: Number(year),
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
  const format = options.format ?? 'iso'
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
