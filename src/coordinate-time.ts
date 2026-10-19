import { floorDiv } from './numeric.js'

// TCG and TCB are defined by IAU resolutions as exact linear functions of TT
// and TDB, with decimal defining constants. Carried as integer ratios, the
// conversions are exact rational arithmetic rounded once to the nanosecond:
// no floating point enters, unlike ERFA's double-precision tttcg/tdbtcb.

/** L_G = 6.969290134e-10 exactly (IAU 2000 Resolution B1.9), as a ratio. */
const LG_NUMERATOR = 6_969_290_134n
const LG_DENOMINATOR = 10n ** 19n
/** L_B = 1.550519768e-8 exactly (IAU 2006 Resolution B3), as a ratio. */
const LB_NUMERATOR = 1_550_519_768n
const LB_DENOMINATOR = 10n ** 17n
/** TDB0 = −6.55e-5 s exactly (IAU 2006 Resolution B3), in nanoseconds. */
const TDB0_NANOS = -65_500n
/**
 * T0 = 1977-01-01T00:00:32.184 (JD 2443144.5003725) on each scale's own clock,
 * as nanoseconds since that clock's 1970-01-01: where TT, TCG and TCB agree
 * (TDB up to TDB0) by definition.
 */
const T0_NANOS = 220_924_832_184_000_000n
const FEMTOS_PER_NANO = 1_000_000n

/** a / b rounded to the nearest integer, ties away from zero (b > 0). */
function roundDiv(a: bigint, b: bigint): bigint {
  const magnitude = floorDiv((a < 0n ? -a : a) * 2n + b, 2n * b)
  return a < 0n ? -magnitude : magnitude
}

/** TCG reading from a TT reading: TCG − T0 = (TT − T0) / (1 − L_G). */
export const tcgNanosFromTt = (ttNanos: bigint): bigint =>
  T0_NANOS + roundDiv((ttNanos - T0_NANOS) * LG_DENOMINATOR, LG_DENOMINATOR - LG_NUMERATOR)

/** TT reading from a TCG reading: TT = TCG − L_G (TCG − T0). */
export const ttNanosFromTcg = (tcgNanos: bigint): bigint =>
  T0_NANOS + roundDiv((tcgNanos - T0_NANOS) * (LG_DENOMINATOR - LG_NUMERATOR), LG_DENOMINATOR)

/**
 * TCB reading from a TT reading and the unrounded TDB − TT offset in
 * femtoseconds: TCB − T0 = (TT + (TDB − TT) − TDB0 − T0) / (1 − L_B), rounded
 * once. Rounding TDB to a nanosecond first would put a quarter of TCB
 * readings a nanosecond away from the defined value.
 */
export function tcbNanosFromTt(ttNanos: bigint, tdbMinusTtFemtos: bigint): bigint {
  const femtosSinceT0 = (ttNanos - TDB0_NANOS - T0_NANOS) * FEMTOS_PER_NANO + tdbMinusTtFemtos
  return (
    T0_NANOS +
    roundDiv(femtosSinceT0 * LB_DENOMINATOR, (LB_DENOMINATOR - LB_NUMERATOR) * FEMTOS_PER_NANO)
  )
}

/** TDB reading from a TCB reading: TDB = TCB − L_B (TCB − T0) + TDB0. */
export const tdbNanosFromTcb = (tcbNanos: bigint): bigint =>
  T0_NANOS +
  TDB0_NANOS +
  roundDiv((tcbNanos - T0_NANOS) * (LB_DENOMINATOR - LB_NUMERATOR), LB_DENOMINATOR)
