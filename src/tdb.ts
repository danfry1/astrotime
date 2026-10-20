import { deterministicSin } from './numeric.js'
import { FAIRHEAD_BRETAGNON_BLOCKS, FAIRHEAD_BRETAGNON_TERMS } from './tdb-series.js'

/** Days in a Julian millennium, the series' time unit. */
const DAYS_PER_MILLENNIUM = 365_250
/**
 * Julian millennia from J2000 beyond which the T^n factors are held constant.
 * ERFA's polynomial blocks grow without bound (a T^4 block reaches ~1000 s at
 * ±700 millennia), and where the double time argument is only millisecond-
 * resolved that growth turns the forward map into a microsecond staircase no
 * inverse can stay within a nanosecond of. Holding the factors keeps the
 * offset continuous, bounded and invertible over the ±999 999-year civil
 * range, and changes nothing within ±10 000 years of J2000.
 */
const POLYNOMIAL_LIMIT_MILLENNIA = 10

/** Sum of the terms `[first, end)`, in ERFA's descending-index order. */
function blockSum(first: number, end: number, t: number): number {
  let sum = 0
  for (let term = end - 1; term >= first; term -= 1) {
    const offset = term * 3
    // Indices stay inside the generated table, whose length a test pins.
    sum +=
      FAIRHEAD_BRETAGNON_TERMS[offset]! *
      deterministicSin(
        FAIRHEAD_BRETAGNON_TERMS[offset + 1]! * t + FAIRHEAD_BRETAGNON_TERMS[offset + 2]!,
      )
  }
  return sum
}

/**
 * Geocentric TDB − TT in seconds for a TT time expressed as days since J2000:
 * the full 787-term Fairhead & Bretagnon (1990) series with ERFA's JPL-mass
 * adjustments, evaluated in ERFA `dtdb`'s term order with the observer terms
 * supplied separately as `topocentric` (zero for the geocentre, as astropy
 * uses for a `Time` without a location). ERFA quotes
 * ±3 ns absolute accuracy against DE405 over 1950–2050. Identical to ERFA
 * within ±10 000 years of J2000; beyond that the polynomial factors are held
 * (see `POLYNOMIAL_LIMIT_MILLENNIA`), where neither form is physical.
 */
export function fairheadBretagnonTdbMinusTt(daysSinceJ2000Tt: number, topocentric = 0): number {
  const t = daysSinceJ2000Tt / DAYS_PER_MILLENNIUM
  const [t0, t1, t2, t3, t4, end] = FAIRHEAD_BRETAGNON_BLOCKS
  const w0 = blockSum(t0, t1, t)
  const w1 = blockSum(t1, t2, t)
  const w2 = blockSum(t2, t3, t)
  const w3 = blockSum(t3, t4, t)
  const w4 = blockSum(t4, end, t)
  const p = Math.min(Math.max(t, -POLYNOMIAL_LIMIT_MILLENNIA), POLYNOMIAL_LIMIT_MILLENNIA)
  const series = p * (p * (p * (p * w4 + w3) + w2) + w1) + w0
  // Adjustments to use JPL planetary masses instead of IAU (ERFA dtdb).
  const jpl =
    0.000_65e-6 * deterministicSin(6069.776_754 * t + 4.021_194) +
    0.000_33e-6 * deterministicSin(213.299_095 * t + 5.543_132) +
    -0.001_96e-6 * deterministicSin(6208.294_251 * t + 5.696_701) +
    -0.001_73e-6 * deterministicSin(74.781_599 * t + 2.4359) +
    0.036_38e-6 * p * p
  // ERFA's grouping, (topocentric + series) + jpl; exactly series + jpl when geocentric.
  return topocentric + series + jpl
}
