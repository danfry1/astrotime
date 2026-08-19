/** Shared tokenizer for instant and duration format patterns. */

export type PatternToken =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'field'; readonly name: string; readonly width: number }

/**
 * Splits a pattern into literal runs and field tokens.
 * `[...]` escapes a literal; `tokenRegex` must be sticky-free and match one
 * field token (a run of identical letters) at the current position.
 */
export function tokenize(pattern: string, tokenRegex: RegExp): readonly PatternToken[] {
  const tokens: PatternToken[] = []
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
    const match = tokenRegex.exec(pattern.slice(i))
    if (match !== null && match.index === 0) {
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

export const pad = (value: number | bigint, width: number): string =>
  String(value).padStart(width, '0')

/** Formats a nanosecond fraction (0–999 999 999) to exactly `digits` digits, truncating. */
export const fractionDigits = (nanos: number | bigint, digits: number): string =>
  String(nanos).padStart(9, '0').slice(0, digits)

/** Exact conversion of a decimal fraction string (digits after the point) to nanoseconds of `unitNanos`. */
export function fractionToNanos(fraction: string, unitNanos: bigint): bigint {
  if (fraction === '') return 0n
  const scale = 10n ** BigInt(fraction.length)
  return (BigInt(fraction) * unitNanos) / scale
}
