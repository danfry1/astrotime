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

/** Bounded memo of tokenized patterns (cleared when full, so caller-supplied patterns cannot grow memory unboundedly). */
export function tokenCache(
  tokenRegex: RegExp,
  max = 256,
): (pattern: string) => readonly PatternToken[] {
  const cache = new Map<string, readonly PatternToken[]>()
  return (pattern) => {
    const cached = cache.get(pattern)
    if (cached !== undefined) return cached
    const tokens = tokenize(pattern, tokenRegex)
    if (cache.size >= max) cache.clear()
    cache.set(pattern, tokens)
    return tokens
  }
}

/**
 * Letters in `pattern` that are neither part of a token matched by
 * `tokenRegex` nor inside a `[literal]` block, in order and deduplicated.
 * Bracketed text is removed before tokenising: `tokenize` reports it as an
 * ordinary literal, which would otherwise be indistinguishable from a typo.
 */
export function unknownTokensIn(pattern: string, tokenRegex: RegExp): readonly string[] {
  const withoutEscapes = pattern.replace(/\[[^\]]*\]/g, '')
  const unknown: string[] = []
  for (const token of tokenize(withoutEscapes, tokenRegex)) {
    if (token.kind !== 'literal') continue
    for (const run of token.text.match(/[A-Za-z]+/g) ?? []) {
      if (!unknown.includes(run)) unknown.push(run)
    }
  }
  return unknown
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
