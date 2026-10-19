import { NANOS_PER_DAY } from './duration.js'
import {
  type EarthOrientationOptions,
  type EarthOrientationTable,
  greenwichMeanSiderealTime,
} from './earth-orientation.js'
import type { EarthOrientationError } from './errors.js'
import type { Instant } from './instant.js'
import {
  EQUINOX_COMPLEMENTARY,
  NUTATION_LUNI_SOLAR,
  NUTATION_PLANETARY,
} from './nutation-series.js'
import { deterministicCos, deterministicSin } from './numeric.js'
import { ok, type Result } from './result.js'

// IAU 2006/2000A nutation, obliquity and the equation of the equinoxes,
// following ERFA nut00a, nut06a, obl06 and eect00 step for step (same terms,
// same summation order, same fmod reductions — ECMAScript `%` is the exact
// IEEE remainder C's fmod computes). Sines and cosines are the deterministic
// polynomials, so results are bit-identical across engines.

/** Arcseconds to radians: the double ERFA_DAS2R (4.848136811095359935899141e-6) rounds to. */
const DAS2R = 4.848_136_811_095_36e-6
/** Arcseconds in a full turn. */
const TURNAS = 1_296_000
/** 2π: the double ERFA_D2PI rounds to. */
const D2PI = 2 * Math.PI
/** 0.1 µas to radians. */
const U2R = DAS2R / 1e7
/** The J2000.0 epoch (2000-01-01T12:00:00 TT) as TAI nanoseconds since 1970. */
const J2000_TT_TAI_NANOS = 946_727_967_816_000_000n
const NANOS_PER_JULIAN_CENTURY = 36_525n * NANOS_PER_DAY

/** Julian centuries of TT since J2000.0 (TT and TAI tick together). */
const ttCenturies = (instant: Instant): number =>
  Number(instant.taiNanos - J2000_TT_TAI_NANOS) / Number(NANOS_PER_JULIAN_CENTURY)

// Fundamental arguments, IERS Conventions 2003 (ERFA fal03 … fapa03).
const fal03 = (t: number) =>
  ((485_868.249_036 +
    t * (1_717_915_923.217_8 + t * (31.879_2 + t * (0.051_635 + t * -0.000_244_7)))) %
    TURNAS) *
  DAS2R
const falp03 = (t: number) =>
  ((1_287_104.793_048 +
    t * (129_596_581.048_1 + t * (-0.553_2 + t * (0.000_136 + t * -0.000_011_49)))) %
    TURNAS) *
  DAS2R
const faf03 = (t: number) =>
  ((335_779.526_232 +
    t * (1_739_527_262.847_8 + t * (-12.751_2 + t * (-0.001_037 + t * 0.000_004_17)))) %
    TURNAS) *
  DAS2R
const fad03 = (t: number) =>
  ((1_072_260.703_692 +
    t * (1_602_961_601.209 + t * (-6.370_6 + t * (0.006_593 + t * -0.000_031_69)))) %
    TURNAS) *
  DAS2R
const faom03 = (t: number) =>
  ((450_160.398_036 +
    t * (-6_962_890.543_1 + t * (7.472_2 + t * (0.007_702 + t * -0.000_059_39)))) %
    TURNAS) *
  DAS2R
const fame03 = (t: number) => (4.402_608_842 + 2608.790_314_157_4 * t) % D2PI
const fave03 = (t: number) => (3.176_146_697 + 1021.328_554_621_1 * t) % D2PI
const fae03 = (t: number) => (1.753_470_314 + 628.307_584_999_1 * t) % D2PI
const fama03 = (t: number) => (6.203_480_913 + 334.061_242_67 * t) % D2PI
const faju03 = (t: number) => (0.599_546_497 + 52.969_096_264_1 * t) % D2PI
const fasa03 = (t: number) => (0.874_016_757 + 21.329_910_496 * t) % D2PI
const faur03 = (t: number) => (5.481_293_872 + 7.478_159_856_7 * t) % D2PI
const fapa03 = (t: number) => (0.024_381_75 + 0.000_005_386_91 * t) * t

/** Luni-solar nutation in 0.1 µas: [Δψ, Δε] (MHB2000 arguments for l′ and D, as ERFA). */
function luniSolar(t: number): [number, number] {
  const el = fal03(t)
  const elp =
    ((1_287_104.793_05 +
      t * (129_596_581.048_1 + t * (-0.553_2 + t * (0.000_136 + t * -0.000_011_49)))) %
      TURNAS) *
    DAS2R
  const f = faf03(t)
  const d =
    ((1_072_260.703_69 +
      t * (1_602_961_601.209 + t * (-6.370_6 + t * (0.006_593 + t * -0.000_031_69)))) %
      TURNAS) *
    DAS2R
  const om = faom03(t)
  const s = NUTATION_LUNI_SOLAR
  let dp = 0
  let de = 0
  for (let row = s.length - 11; row >= 0; row -= 11) {
    const arg =
      (s[row]! * el + s[row + 1]! * elp + s[row + 2]! * f + s[row + 3]! * d + s[row + 4]! * om) %
      D2PI
    const sarg = deterministicSin(arg)
    const carg = deterministicCos(arg)
    dp += (s[row + 5]! + s[row + 6]! * t) * sarg + s[row + 7]! * carg
    de += (s[row + 8]! + s[row + 9]! * t) * carg + s[row + 10]! * sarg
  }
  return [dp, de]
}

/** The 13 planetary-series arguments: l, F, D, Ω (MHB2000), Mercury … Neptune, p_A. */
const planetaryArguments = (t: number): readonly number[] => [
  (2.355_555_98 + 8328.691_426_955_4 * t) % D2PI,
  (1.627_905_234 + 8433.466_158_131 * t) % D2PI,
  (5.198_466_741 + 7771.377_146_812_1 * t) % D2PI,
  (2.182_439_2 - 33.757_045 * t) % D2PI,
  fame03(t),
  fave03(t),
  fae03(t),
  fama03(t),
  faju03(t),
  fasa03(t),
  faur03(t),
  (5.321_159 + 3.812_777_4 * t) % D2PI,
  fapa03(t),
]

/** Planetary nutation in 0.1 µas: [Δψ, Δε]. */
function planetary(t: number): [number, number] {
  const a = planetaryArguments(t)
  const p = NUTATION_PLANETARY
  let dp = 0
  let de = 0
  for (let row = p.length - 17; row >= 0; row -= 17) {
    let arg = 0
    for (let k = 0; k < 13; k += 1) arg += p[row + k]! * a[k]!
    arg %= D2PI
    const sarg = deterministicSin(arg)
    const carg = deterministicCos(arg)
    dp += p[row + 13]! * sarg + p[row + 14]! * carg
    de += p[row + 15]! * sarg + p[row + 16]! * carg
  }
  return [dp, de]
}

/** Nutation in longitude and obliquity, radians. */
export type Nutation = {
  /** Δψ, nutation in longitude. */
  readonly dpsi: number
  /** Δε, nutation in obliquity. */
  readonly deps: number
}

function nutationAt(t: number): Nutation {
  const [lsPsi, lsEps] = luniSolar(t)
  const [plPsi, plEps] = planetary(t)
  const dp = lsPsi * U2R + plPsi * U2R
  const de = lsEps * U2R + plEps * U2R
  // IAU 2006 adjustments for the J2 rate and the precession it implies (nut06a).
  const fj2 = -2.777_4e-6 * t
  return { dpsi: dp + dp * (0.469_7e-6 + fj2), deps: de + de * fj2 }
}

/**
 * Nutation (IAU 2000A with the IAU 2006 adjustments, as ERFA `nut06a`) at
 * `instant`: Δψ and Δε in radians, ~1 365 terms. Takes TT (TDB would be
 * strictly correct; the difference is negligible, as ERFA notes). Like the
 * model, meaningful within a few centuries of J2000.
 */
export const nutation = (instant: Instant): Nutation => nutationAt(ttCenturies(instant))

const obliquityAt = (t: number): number =>
  (84_381.406 +
    (-46.836_769 +
      (-0.000_183_1 + (0.002_003_4 + (-0.000_000_576 + -0.000_000_043_4 * t) * t) * t) * t) *
      t) *
  DAS2R

/** Mean obliquity of the ecliptic (IAU 2006, as ERFA `obl06`) at `instant`, radians. */
export const meanObliquity = (instant: Instant): number => obliquityAt(ttCenturies(instant))

/** Complementary terms of the equation of the equinoxes (ERFA `eect00`), radians. */
function complementaryTerms(t: number): number {
  const fa = [fal03(t), falp03(t), faf03(t), fad03(t), faom03(t), fave03(t), fae03(t), fapa03(t)]
  const e = EQUINOX_COMPLEMENTARY
  const sum = (first: number, end: number): number => {
    let total = 0
    for (let row = (end - 1) * 10; row >= first * 10; row -= 10) {
      let a = 0
      for (let k = 0; k < 8; k += 1) a += e[row + k]! * fa[k]!
      total += e[row + 8]! * deterministicSin(a) + e[row + 9]! * deterministicCos(a)
    }
    return total
  }
  return (sum(0, 33) + sum(33, 34) * t) * DAS2R
}

const equinoxesAt = (t: number): number =>
  nutationAt(t).dpsi * deterministicCos(obliquityAt(t)) + complementaryTerms(t)

/**
 * Equation of the equinoxes (IAU 2006/2000A) at `instant`, radians:
 * Δψ cos ε_A plus the complementary terms — apparent minus mean sidereal
 * time. Within 1.5e-11 rad (3.1 µas) of ERFA `ee06a` over 1800–2200, which
 * derives it through the full precession-nutation matrix.
 */
export const equationOfTheEquinoxes = (instant: Instant): number =>
  equinoxesAt(ttCenturies(instant))

/**
 * Greenwich Apparent Sidereal Time (IAU 2006/2000A) at `instant`, radians in
 * [0, 2π): mean sidereal time plus the equation of the equinoxes. Within
 * 1.5e-11 rad (3.1 µas) of ERFA `gst06a` on the same UT1 over 1800–2200;
 * accuracy is otherwise that of the interpolated UT1 (~7e-10 rad for recent
 * data).
 */
export function greenwichApparentSiderealTime(
  instant: Instant,
  table: EarthOrientationTable,
  options: EarthOrientationOptions = {},
): Result<number, EarthOrientationError> {
  const gmst = greenwichMeanSiderealTime(instant, table, options)
  if (!gmst.ok) return gmst
  return ok((((gmst.value + equationOfTheEquinoxes(instant)) % D2PI) + D2PI) % D2PI)
}
