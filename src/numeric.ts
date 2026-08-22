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

/** bigint nanoseconds → finite float `unit`s without cancellation error; throws on numeric overflow. */
export function fromNanos(nanos: bigint, unitNanos: bigint): number {
  const whole = nanos / unitNanos
  const value = Number(whole) + Number(nanos - whole * unitNanos) / Number(unitNanos)
  if (!Number.isFinite(value)) {
    throw new RangeError('Nanosecond value is outside the finite Number range')
  }
  return value
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

export const assertSafeInteger = (value: number, what: string): void => {
  if (!Number.isInteger(value))
    throw new RangeError(`${what} must be an integer, got ${String(value)}`)
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${what} must be a safe integer, got ${String(value)}`)
}

// ---------------------------------------------------------------------------
// Deterministic sine
//
// ECMAScript does not specify Math.sin bit-exactly, so different engines
// (V8, JSC, SpiderMonkey, Hermes) may disagree by ULPs. The TDB periodic
// series is the only transcendental call in this library; this deterministic
// implementation uses only IEEE-exact operations (+, −, ×, ÷, floor), making
// every astrotime output bit-identical across engines.

const TWO_PI_HI = 6.283185307179586
const TWO_PI_LO = 2.449293598294706e-16
const INV_TWO_PI = 0.15915494309189535

/**
 * sin(x) for |x| ≤ ~1e9 rad, deterministic across JS engines, absolute error
 * < 1e-13 after reduction (argument-reduction error grows as |x|·2.4e-16 —
 * over the validated 1972–2100 TDB interval, where |x| < 1e4, the total error
 * stays below 1e-11, i.e. < 0.02 ns of TDB offset).
 */
export function deterministicSin(x: number): number {
  // Cody–Waite reduction: x − k·2π with 2π split into exact-product halves.
  const k = Math.floor(x * INV_TWO_PI + 0.5)
  let r = x - k * TWO_PI_HI
  r -= k * TWO_PI_LO
  // r ∈ [−π, π]; fold into [−π/2, π/2] where the polynomial converges fast.
  const HALF_PI = Math.PI / 2
  if (r > HALF_PI) {
    r = TWO_PI_HI / 2 - r
  } else if (r < -HALF_PI) {
    r = -TWO_PI_HI / 2 - r
  }
  // Taylor series to x^15: max error ~4e-15 on [−π/2, π/2].
  const r2 = r * r
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 *
                (-1 / 5040 +
                  r2 *
                    (1 / 362_880 +
                      r2 *
                        (-1 / 39_916_800 + r2 * (1 / 6_227_020_800 - r2 / 1_307_674_368_000)))))))
  )
}
