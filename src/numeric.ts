/** Shared integer/bigint helpers. */

/** Floor division for bigint (rounds toward −∞, unlike `/`). */
export const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/** Rounds half away from zero, symmetric for negatives (unlike `Math.round`). */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

/**
 * Converts a possibly fractional count of `unit`s (as nanoseconds per unit) to
 * exact nanoseconds, rounding half away from zero. Large magnitudes keep the
 * integer part exact because only the fraction goes through float arithmetic.
 */
export function toNanos(value: number, unitNanos: bigint, what: string): bigint {
  if (!Number.isFinite(value))
    throw new RangeError(`${what} must be a finite number, got ${String(value)}`)
  const whole = Math.trunc(value)
  const fraction = value - whole
  return BigInt(whole) * unitNanos + BigInt(roundHalfAway(fraction * Number(unitNanos)))
}

/** bigint nanoseconds → float `unit`s without cancellation error (whole and fraction share a sign). */
export function fromNanos(nanos: bigint, unitNanos: bigint): number {
  const whole = nanos / unitNanos
  return Number(whole) + Number(nanos - whole * unitNanos) / Number(unitNanos)
}

/**
 * Multiplies bigint nanoseconds by a float factor exactly: the factor is
 * decomposed into `m × 2^-e` with integer `m`, so the product is an exact
 * integer before a single round-half-away-from-zero step.
 */
export function scaleNanosExact(nanos: bigint, factor: number, what: string): bigint {
  if (!Number.isFinite(factor))
    throw new RangeError(`${what} must be a finite number, got ${String(factor)}`)
  let m = factor
  let e = 0
  while (!Number.isInteger(m)) {
    m *= 2
    e += 1
  }
  const product = nanos * BigInt(m)
  if (e === 0) return product
  const divisor = 1n << BigInt(e)
  const q = product / divisor
  const r = product - q * divisor
  const twice = (r < 0n ? -r : r) * 2n
  if (twice < divisor) return q
  return product < 0n ? q - 1n : q + 1n
}

export const assertInteger = (value: number, what: string): void => {
  if (!Number.isInteger(value))
    throw new RangeError(`${what} must be an integer, got ${String(value)}`)
}
