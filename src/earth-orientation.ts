import { civilFromDays } from './calendar.js'
import { NANOS_PER_DAY, NANOS_PER_SECOND } from './duration.js'
import { EarthOrientationError } from './errors.js'
import { deltaAt, type Instant } from './instant.js'
import { deltaAtUnixSeconds, type LeapSecondTable } from './leap-seconds.js'
import { floorDiv } from './numeric.js'
import { assertOptionsObject } from './options.js'
import { err, ok, type Result } from './result.js'

/** One daily row of Earth-orientation data, at 0h UTC of `mjd`. */
export type EarthOrientationEntry = {
  /** Modified Julian Date of the row's UTC midnight (an integer). */
  readonly mjd: number
  /** UT1 − UTC in seconds (|value| < 1 by the definition of UTC). */
  readonly ut1MinusUtc: number
  /** Polar motion x, arcseconds. */
  readonly xp: number
  /** Polar motion y, arcseconds. */
  readonly yp: number
  /** Whether UT1 − UTC is an IERS Bulletin A prediction rather than an observed value. */
  readonly predicted: boolean
}

export type EarthOrientationTable = {
  /** Ascending by `mjd`, at least two rows. */
  readonly entries: readonly EarthOrientationEntry[]
}

export type EarthOrientationOptions = {
  /**
   * `'lagrange'` (default) — four-point Lagrange interpolation, as the IERS
   * recommends for daily values; `'linear'` — two-point, as astropy uses.
   * UT1 − UTC's fortnightly tidal term (~0.8 ms) gives linear interpolation
   * errors up to ~20 µs, above the ~10 µs uncertainty of recent data.
   */
  readonly interpolation?: 'lagrange' | 'linear' | undefined
  /** Leap-second table used to turn UT1 − UTC into the continuous UT1 − TAI. */
  readonly leapSeconds?: LeapSecondTable | undefined
}

/** Interpolated Earth orientation at an instant. */
export type EarthOrientation = {
  /** UT1 − UTC in seconds. Jumps by one second across a leap second. */
  readonly ut1MinusUtc: number
  /** UT1 − TAI in seconds. Continuous, and what UT1 is computed from. */
  readonly ut1MinusTai: number
  /** Polar motion x, arcseconds. */
  readonly xp: number
  /** Polar motion y, arcseconds. */
  readonly yp: number
  /** Whether any row contributing to the interpolation is a prediction. */
  readonly predicted: boolean
}

const SECONDS_PER_DAY = 86_400
const MJD_UNIX_EPOCH = 40_587
const FEMTOS_PER_NANO = 1_000_000n
const FEMTOS_PER_DAY = NANOS_PER_DAY * FEMTOS_PER_NANO
/** UT1 femtoseconds since 1970-01-01T00:00:00 UT1 at 2000-01-01T12:00:00 UT1. */
const J2000_FEMTOS = 10_957n * FEMTOS_PER_DAY + FEMTOS_PER_DAY / 2n
const MAX_FINALS_LINES = 200_000
const TWO_PI = 2 * Math.PI
const ARCSEC_TO_RADIANS = Math.PI / 648_000

// ---------------------------------------------------------------------------
// IERS finals2000A parsing

/** A fixed-width numeric field: its value, `null` when blank, or `undefined` when malformed. */
function fixedField(line: string, start: number, end: number): number | null | undefined {
  const text = line.slice(start - 1, end).trim()
  if (text === '') return null
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : undefined
}

/** `yy mm dd` columns agree with the MJD (1900s for MJD ≤ 51543, as the format specifies). */
function datesAgree(line: string, mjd: number): boolean {
  const date = civilFromDays(mjd - MJD_UNIX_EPOCH)
  const yy = date.year - (mjd <= 51_543 ? 1900 : 2000)
  return (
    fixedField(line, 1, 2) === yy &&
    fixedField(line, 3, 4) === date.month &&
    fixedField(line, 5, 6) === date.day
  )
}

/** Bulletin B where present (final values), otherwise Bulletin A — astropy's rule. */
function preferB(a: number | null | undefined, b: number | null | undefined): number | undefined {
  if (b === undefined || a === undefined) return undefined
  return b ?? a ?? undefined
}

/** A parsed row, `null` for a row past the end of UT1 − UTC, or the reason a row is malformed. */
type FinalsRow = EarthOrientationEntry | null | { readonly problem: string }

function parseFinalsRow(line: string): FinalsRow {
  const mjd = fixedField(line, 8, 15)
  // Blank (null) and malformed (undefined) fields fail the safe-integer test too.
  if (typeof mjd !== 'number' || !Number.isSafeInteger(mjd))
    return { problem: 'MJD (columns 8–15) must be a whole day' }
  if (!datesAgree(line, mjd)) return { problem: `date columns disagree with MJD ${String(mjd)}` }
  const ut1A = fixedField(line, 59, 68)
  if (ut1A === null) return null
  const flag = line.charAt(57)
  if (flag !== 'I' && flag !== 'P') return { problem: 'UT1 − UTC flag (column 58) must be I or P' }
  const ut1B = fixedField(line, 155, 165)
  const ut1MinusUtc = preferB(ut1A, ut1B)
  const xp = preferB(fixedField(line, 19, 27), fixedField(line, 135, 144))
  const yp = preferB(fixedField(line, 38, 46), fixedField(line, 145, 154))
  if (ut1MinusUtc === undefined || xp === undefined || yp === undefined)
    return { problem: 'malformed UT1 − UTC or polar-motion field' }
  return { mjd, ut1MinusUtc, xp, yp, predicted: ut1B === null && flag === 'P' }
}

/**
 * Parses IERS `finals2000A` Earth-orientation data (`finals2000A.all`,
 * `.data` or `.daily`, from the IERS Rapid Service/Prediction Centre). Uses
 * Bulletin B values where present and Bulletin A otherwise, keeping Bulletin
 * A's prediction flag. Trailing rows without UT1 − UTC (beyond the
 * predictions) are skipped; any other malformed row is an error naming its
 * line. Nothing is bundled: EOP data changes daily, so supply a current file.
 */
export function parseIersFinals(
  text: string,
): Result<EarthOrientationTable, EarthOrientationError> {
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_FINALS_LINES)
    return err(new EarthOrientationError(MAX_FINALS_LINES + 1, 'file exceeds the line limit'))
  const entries: EarthOrientationEntry[] = []
  let ended = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.trim() === '') continue
    const row = parseFinalsRow(line)
    if (row === null) {
      ended = true
    } else if ('problem' in row) {
      return err(new EarthOrientationError(index + 1, row.problem))
    } else if (ended) {
      return err(new EarthOrientationError(index + 1, 'UT1 − UTC resumes after a row without it'))
    } else {
      entries.push(Object.freeze(row))
    }
  }
  const table = Object.freeze({ entries: Object.freeze(entries) })
  const problem = tableProblem(table)
  return problem === null ? ok(table) : err(new EarthOrientationError(lines.length, problem))
}

// ---------------------------------------------------------------------------
// Validation and interpolation

function entryProblem(entry: EarthOrientationEntry, previousMjd: number): string | null {
  if (!Number.isSafeInteger(entry.mjd) || entry.mjd <= previousMjd)
    return 'mjd must be safe integers in strictly ascending order'
  if (!Number.isFinite(entry.ut1MinusUtc) || Math.abs(entry.ut1MinusUtc) >= 1)
    return 'ut1MinusUtc must be finite and within (−1, 1) seconds'
  if (!Number.isFinite(entry.xp) || !Number.isFinite(entry.yp)) return 'polar motion must be finite'
  if (typeof entry.predicted !== 'boolean') return 'predicted must be a boolean'
  return null
}

function tableProblem(table: EarthOrientationTable): string | null {
  const entries: unknown = (table as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries) || entries.length < 2) return 'a table needs at least two entries'
  let previous = Number.NEGATIVE_INFINITY
  for (const entry of entries as readonly EarthOrientationEntry[]) {
    if (typeof entry !== 'object' || entry === null) return 'entries must be objects'
    const problem = entryProblem(entry, previous)
    if (problem !== null) return problem
    previous = entry.mjd
  }
  return null
}

const validatedTables = new WeakSet<EarthOrientationTable>()

function assertValidTable(table: EarthOrientationTable): void {
  if (validatedTables.has(table)) return
  const problem = tableProblem(table)
  if (problem !== null) throw new RangeError(`Invalid Earth-orientation table: ${problem}`)
  if (Object.isFrozen(table) && Object.isFrozen(table.entries)) validatedTables.add(table)
}

type Node = {
  /** The row's UTC midnight on the TAI axis, whole seconds since 1970. */
  readonly taiSeconds: number
  readonly entry: EarthOrientationEntry
  readonly ut1MinusTai: number
}

/** A row placed on the TAI axis, with its continuous UT1 − TAI. */
function node(entry: EarthOrientationEntry, leapSeconds: LeapSecondTable | undefined): Node {
  const unixSeconds = (entry.mjd - MJD_UNIX_EPOCH) * SECONDS_PER_DAY
  const offset = deltaAtUnixSeconds(unixSeconds, { leapSeconds })
  return { taiSeconds: unixSeconds + offset, entry, ut1MinusTai: entry.ut1MinusUtc - offset }
}

const nodeNanos = (n: Node): bigint => BigInt(n.taiSeconds) * NANOS_PER_SECOND

/** Index of the last row at or before `taiNanos`, or −1 before the table. */
function rowAtOrBefore(
  entries: readonly EarthOrientationEntry[],
  taiNanos: bigint,
  leapSeconds: LeapSecondTable | undefined,
): number {
  let low = 0
  let high = entries.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (nodeNanos(node(entries[middle]!, leapSeconds)) <= taiNanos) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/**
 * Lagrange interpolation through `nodes` at `x`, seconds from the first node.
 * Abscissae are taken relative to that node, so they are small exact
 * integers (a leap day is simply 86 401 s long).
 */
function lagrange(nodes: readonly Node[], x: number, value: (node: Node) => number): number {
  const origin = nodes[0]!.taiSeconds
  let sum = 0
  for (let i = 0; i < nodes.length; i += 1) {
    const xi = nodes[i]!.taiSeconds - origin
    let weight = 1
    for (let j = 0; j < nodes.length; j += 1) {
      if (j !== i) {
        const xj = nodes[j]!.taiSeconds - origin
        weight *= (x - xj) / (xi - xj)
      }
    }
    sum += weight * value(nodes[i]!)
  }
  return sum
}

/** First and last index of the run of consecutive days containing `row`. */
function dailyRun(entries: readonly EarthOrientationEntry[], row: number): [number, number] {
  let first = row
  while (first > 0 && entries[first - 1]!.mjd === entries[first]!.mjd - 1) first -= 1
  let last = row
  while (last < entries.length - 1 && entries[last + 1]!.mjd === entries[last]!.mjd + 1) last += 1
  return [first, last]
}

/**
 * The rows the interpolation uses around `row`: two, or up to four, always
 * inside one run of consecutive days so a gap in the data is never bridged.
 */
function window(
  entries: readonly EarthOrientationEntry[],
  row: number,
  points: number,
): [number, number] {
  const [runFirst, runLast] = dailyRun(entries, row)
  if (points === 2) {
    const last = Math.min(row + 1, runLast)
    return [Math.max(runFirst, last - 1), last]
  }
  const first = Math.max(runFirst, Math.min(row - 1, runLast - 3))
  return [first, Math.min(runLast, first + 3)]
}

/**
 * Earth orientation at `instant`, interpolated from `table`: UT1 − UTC,
 * UT1 − TAI and polar motion. Interpolates UT1 − TAI, which is continuous,
 * so a leap second inside the window does not corrupt it. Returns an error
 * when the instant is outside the table's first and last rows: EOP values
 * are never extrapolated. Sub-daily ocean-tide and libration terms (IERS
 * Conventions ch. 5, tens of µs in UT1) are not applied, as in ERFA and
 * astropy.
 */
export function earthOrientationAt(
  instant: Instant,
  table: EarthOrientationTable,
  options: EarthOrientationOptions = {},
): Result<EarthOrientation, EarthOrientationError> {
  assertOptionsObject(options, 'earthOrientationAt')
  assertValidTable(table)
  const points = interpolationPoints(options.interpolation)
  const { entries } = table
  const leapSeconds = options.leapSeconds
  const row = rowAtOrBefore(entries, instant.taiNanos, leapSeconds)
  const lastNode = node(entries[entries.length - 1]!, leapSeconds)
  if (row === -1 || instant.taiNanos > nodeNanos(lastNode)) {
    return err(
      new EarthOrientationError(
        null,
        `the instant is outside the table, which covers MJD ${String(entries[0]!.mjd)}–${String(lastNode.entry.mjd)} (UTC)`,
      ),
    )
  }
  const [first, last] = window(entries, row, points)
  const nodes = entries.slice(first, last + 1).map((entry) => node(entry, leapSeconds))
  if (instant.taiNanos > nodeNanos(nodes.at(-1)!)) {
    return err(
      new EarthOrientationError(
        null,
        `the table has no rows between MJD ${String(entries[row]!.mjd)} and ${String(entries[row + 1]!.mjd)}; EOP values are not interpolated across a gap`,
      ),
    )
  }
  const x = Number(instant.taiNanos - nodeNanos(nodes[0]!)) / Number(NANOS_PER_SECOND)
  const ut1MinusTai = lagrange(nodes, x, (n) => n.ut1MinusTai)
  // TAI − UTC as UTC itself has it: inside a leap second, still the old value.
  const utcOffset = deltaAt(instant, { leapSeconds })
  return ok({
    ut1MinusUtc: ut1MinusTai + utcOffset,
    ut1MinusTai,
    xp: lagrange(nodes, x, (n) => n.entry.xp),
    yp: lagrange(nodes, x, (n) => n.entry.yp),
    predicted: nodes.some((n) => n.entry.predicted),
  })
}

function interpolationPoints(interpolation: unknown): 2 | 4 {
  if (interpolation === undefined || interpolation === 'lagrange') return 4
  if (interpolation === 'linear') return 2
  throw new RangeError(
    `interpolation must be "lagrange" or "linear", got ${JSON.stringify(interpolation) ?? typeof interpolation}`,
  )
}

// ---------------------------------------------------------------------------
// UT1, Earth rotation angle and sidereal time

/** UT1 as femtoseconds since 1970-01-01T00:00:00 UT1. */
const ut1Femtos = (instant: Instant, ut1MinusTai: number): bigint =>
  instant.taiNanos * FEMTOS_PER_NANO + BigInt(Math.round(ut1MinusTai * 1e15))

/**
 * Two-part UT1 Julian date at `instant` (`jd1` a whole or half day, `jd2` the
 * remainder), for ERFA-style functions that take UT1.
 */
export function instantToUt1JulianDateParts(
  instant: Instant,
  table: EarthOrientationTable,
  options: EarthOrientationOptions = {},
): Result<{ readonly jd1: number; readonly jd2: number }, EarthOrientationError> {
  const orientation = earthOrientationAt(instant, table, options)
  if (!orientation.ok) return orientation
  const femtos = ut1Femtos(instant, orientation.value.ut1MinusTai)
  const day = floorDiv(femtos, FEMTOS_PER_DAY)
  const remainder = femtos - day * FEMTOS_PER_DAY
  return ok({ jd1: 2_440_587.5 + Number(day), jd2: Number(remainder) / Number(FEMTOS_PER_DAY) })
}

// IAU 2000 Resolution B1.8: ERA = 2π (0.7790572732640 + 1.00273781191135448 Tu),
// Tu = JD(UT1) − 2451545.0. Constants as integer ratios over 10^17 so the
// angle is reduced to [0, 1) turns exactly before any rounding.
const ERA_SCALE = 10n ** 17n
const ERA_AT_J2000 = 77_905_727_326_400_000n
const ERA_RATE = 100_273_781_191_135_448n

const eraRadians = (femtos: bigint): number => {
  const denominator = ERA_SCALE * FEMTOS_PER_DAY
  const numerator = ERA_AT_J2000 * FEMTOS_PER_DAY + ERA_RATE * (femtos - J2000_FEMTOS)
  const turns = numerator - floorDiv(numerator, denominator) * denominator
  return (Number(turns) / Number(denominator)) * TWO_PI
}

/**
 * Earth Rotation Angle (IAU 2000) at `instant`, radians in [0, 2π). The
 * defining formula is evaluated in exact rational arithmetic; accuracy is
 * that of the interpolated UT1 (~10 µs of UT1 ≈ 7e-10 rad for recent data).
 */
export function earthRotationAngle(
  instant: Instant,
  table: EarthOrientationTable,
  options: EarthOrientationOptions = {},
): Result<number, EarthOrientationError> {
  const orientation = earthOrientationAt(instant, table, options)
  if (!orientation.ok) return orientation
  return ok(eraRadians(ut1Femtos(instant, orientation.value.ut1MinusTai)))
}

/** The J2000.0 epoch (2000-01-01T12:00:00 TT) as TAI nanoseconds since 1970. */
const J2000_TT_TAI_NANOS = 946_727_967_816_000_000n
const NANOS_PER_JULIAN_CENTURY = 36_525n * NANOS_PER_DAY

/**
 * Greenwich Mean Sidereal Time (IAU 2006, as ERFA `gmst06`) at `instant`,
 * radians in [0, 2π): the Earth Rotation Angle plus the IAU 2006 precession
 * polynomial in TT. Apparent sidereal time additionally needs the equation of
 * the equinoxes (nutation), which this function does not include.
 */
export function greenwichMeanSiderealTime(
  instant: Instant,
  table: EarthOrientationTable,
  options: EarthOrientationOptions = {},
): Result<number, EarthOrientationError> {
  const era = earthRotationAngle(instant, table, options)
  if (!era.ok) return era
  // Julian centuries of TT since J2000.0 (TT and TAI tick together).
  const t = Number(instant.taiNanos - J2000_TT_TAI_NANOS) / Number(NANOS_PER_JULIAN_CENTURY)
  const arcseconds =
    0.014_506 +
    (4612.156_534 +
      (1.391_581_7 + (-0.000_000_44 + (-0.000_029_956 + -0.000_000_036_8 * t) * t) * t) * t) *
      t
  // Reduce into [0, 2π) without a sign branch: before J2000 the polynomial is negative.
  return ok((((era.value + arcseconds * ARCSEC_TO_RADIANS) % TWO_PI) + TWO_PI) % TWO_PI)
}
