/** Shared tokenizer and digit helpers for instant and duration format patterns. */

export type PatternToken =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'field'; readonly name: string; readonly width: number }

const stickyCache = new WeakMap<RegExp, RegExp>()

/** Sticky (`y`) clone of a `^`-anchored token regex so matching at offset `i` needs no `slice`. */
function stickyOf(tokenRegex: RegExp): RegExp {
  const cached = stickyCache.get(tokenRegex)
  if (cached !== undefined) return cached
  const source = tokenRegex.source.startsWith('^') ? tokenRegex.source.slice(1) : tokenRegex.source
  const sticky = new RegExp(source, `${tokenRegex.flags.replace('g', '')}y`)
  stickyCache.set(tokenRegex, sticky)
  return sticky
}

/**
 * Splits a pattern into literal runs and field tokens.
 * `[...]` escapes a literal (an unterminated `[` makes the rest literal);
 * `tokenRegex` is a `^`-anchored alternation of field tokens (runs of one letter).
 */
export function tokenize(pattern: string, tokenRegex: RegExp): readonly PatternToken[] {
  const tokens: PatternToken[] = []
  const sticky = stickyOf(tokenRegex)
  let literal = ''
  let i = 0
  const flushLiteral = (): void => {
    if (literal !== '') {
      tokens.push({ kind: 'literal', text: literal })
      literal = ''
    }
  }
  while (i < pattern.length) {
    const ch = pattern[i] ?? ''
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        literal += pattern.slice(i + 1)
        break
      }
      literal += pattern.slice(i + 1, close)
      i = close + 1
      continue
    }
    sticky.lastIndex = i
    const match = sticky.exec(pattern)
    if (match !== null) {
      flushLiteral()
      const text = match[0]
      tokens.push({ kind: 'field', name: text[0] ?? '', width: text.length })
      i += text.length
      continue
    }
    literal += ch
    i += 1
  }
  flushLiteral()
  return tokens
}

/**
 * How a repeated field is identified when checking for duplicates. Width
 * matters only where two widths of one letter are different fields (`DD` is
 * the day of the month, `DDD` the day of the year); elsewhere width is just
 * padding or precision, so `mm` and `m` are the same field.
 */
export type FieldKey = (name: string, width: number) => string

const quote = (s: string): string => JSON.stringify(s)

/**
 * The first structural defect in `pattern`, or `null` when it is sound.
 *
 * Every defect here is one that would otherwise produce output silently
 * different from what the pattern appears to say, so each is reported
 * rather than rendered:
 *
 * - an unterminated `[`, which swallows the bracket and turns the rest of
 *   the pattern into literal text;
 * - a letter run longer than its longest token, which splits into two
 *   tokens (`SSSSSSSSSS` → `SSSSSSSSS` + `S`) and emits a fraction that
 *   does not read back;
 * - the same field twice, which repeats a number instead of formatting the
 *   one the letter was mistaken for (`HH:mm:ss.ms` → `12:34:56.3456`);
 * - a letter belonging to no token, which is rendered verbatim.
 *
 * A `]` outside a bracket is *not* a defect: it renders exactly as written,
 * so nothing is hidden from the reader of the pattern.
 */
export function patternProblem(
  pattern: string,
  tokenRegex: RegExp,
  fieldKey: FieldKey,
): string | null {
  const sticky = stickyOf(tokenRegex)
  const unknown: string[] = []
  const seen = new Map<string, string>()
  let literal = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i] ?? ''
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        return `unterminated ${quote('[')} at position ${String(i)} — every ${quote('[')} needs a closing ${quote(']')}`
      }
      i = close + 1
      continue
    }
    sticky.lastIndex = i
    const match = sticky.exec(pattern)
    if (match === null) {
      literal += ch
      i += 1
      continue
    }
    const text = match[0]
    const name = text[0] ?? ''
    let end = i + text.length
    while (pattern[end] === name) end += 1
    if (end > i + text.length) {
      return `${quote(pattern.slice(i, end))} is longer than the longest ${quote(name)} token (${quote(text)}), so it would split into two fields`
    }
    const key = fieldKey(name, text.length)
    const previous = seen.get(key)
    if (previous !== undefined) {
      return previous === text
        ? `field ${quote(text)} appears more than once`
        : `fields ${quote(previous)} and ${quote(text)} are the same field, used twice`
    }
    seen.set(key, text)
    i = end
  }
  for (const run of literal.match(/[A-Za-z]+/g) ?? []) {
    if (!unknown.includes(run)) unknown.push(run)
  }
  if (unknown.length > 0) {
    return `unknown token(s) ${unknown.map(quote).join(', ')}`
  }
  return null
}

/**
 * Bounded memo of patterns already checked and tokenized. Validation is
 * folded into the cache so a valid pattern is checked once, and the bound is
 * the cache's — a caller supplying endless distinct patterns cannot grow
 * memory, it only re-validates after a clear.
 */
export function validatedTokenCache(
  tokenRegex: RegExp,
  fieldKey: FieldKey,
  describe: (pattern: string, problem: string) => string,
  max = 256,
): (pattern: string) => readonly PatternToken[] {
  const cache = new Map<string, readonly PatternToken[]>()
  return (pattern) => {
    const cached = cache.get(pattern)
    if (cached !== undefined) return cached
    const problem = patternProblem(pattern, tokenRegex, fieldKey)
    if (problem !== null) throw new RangeError(describe(pattern, problem))
    const tokens = tokenize(pattern, tokenRegex)
    if (cache.size >= max) cache.clear()
    cache.set(pattern, tokens)
    return tokens
  }
}

/** Zero-pads a non-negative integer to at least `width` digits. */
export function pad(value: number, width: number): string {
  if (width === 2) return value < 10 ? `0${String(value)}` : String(value)
  if (width === 3)
    return value < 10 ? `00${String(value)}` : value < 100 ? `0${String(value)}` : String(value)
  return String(value).padStart(width, '0')
}

const POW10 = [
  1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000,
] as const

/** Formats a nanosecond fraction (0–999 999 999) to exactly `digits` (1–9) digits, truncating. */
export function fractionDigits(nanos: number, digits: number): string {
  const scaled = Math.floor(nanos / (POW10[9 - digits] ?? 1))
  const text = String(scaled)
  return text.length >= digits ? text : '0'.repeat(digits - text.length) + text
}

/** Exact conversion of a decimal fraction string (digits after the point) to nanoseconds of `unitNanos`, truncating below 1 ns. */
export function fractionToNanos(fraction: string, unitNanos: bigint): bigint {
  if (fraction === '') return 0n
  const scale = 10n ** BigInt(fraction.length)
  return (BigInt(fraction) * unitNanos) / scale
}
