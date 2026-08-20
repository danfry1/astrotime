import { LeapSecondTableError } from './errors.js'
import { err, ok, type Result } from './result.js'

/** One row of a leap-second table: from `unixSeconds` (a UTC midnight) onward, TAI − UTC = `deltaAt`. */
export type LeapSecondEntry = {
  /** Unix seconds (UTC midnight, ignoring leap seconds) at which this offset takes effect. */
  readonly unixSeconds: number
  /** TAI − UTC in whole seconds from that moment. */
  readonly deltaAt: number
}

export type LeapSecondTable = {
  /** Ascending by `unixSeconds`; consecutive entries differ by exactly ±1 s and start at a UTC midnight. */
  readonly entries: readonly LeapSecondEntry[]
  /** Unix seconds after which the table may be missing announcements (IERS Bulletin C expiry), or `null` if unknown. */
  readonly expires: number | null
  /** Unix seconds at which the source list was last updated, or `null`/absent if unknown. */
  readonly updated?: number | null | undefined
}

const NTP_TO_UNIX = 2_208_988_800
/** 1972-01-01T00:00:00 UTC as Unix seconds — where leap-second UTC (and every valid table) begins. */
const UTC_START_SECONDS = 63_072_000
const MJD_TO_UNIX_DAYS = 40_587
const SECONDS_PER_DAY = 86_400

/** Leap-second table from IERS/IANA `leap-seconds.list`, updated 2026-07-06, valid until 2027-06-28. */
export const IERS_LEAP_SECONDS: LeapSecondTable = {
  entries: [
    { unixSeconds: 63_072_000, deltaAt: 10 }, // 1972-01-01
    { unixSeconds: 78_796_800, deltaAt: 11 }, // 1972-07-01
    { unixSeconds: 94_694_400, deltaAt: 12 }, // 1973-01-01
    { unixSeconds: 126_230_400, deltaAt: 13 }, // 1974-01-01
    { unixSeconds: 157_766_400, deltaAt: 14 }, // 1975-01-01
    { unixSeconds: 189_302_400, deltaAt: 15 }, // 1976-01-01
    { unixSeconds: 220_924_800, deltaAt: 16 }, // 1977-01-01
    { unixSeconds: 252_460_800, deltaAt: 17 }, // 1978-01-01
    { unixSeconds: 283_996_800, deltaAt: 18 }, // 1979-01-01
    { unixSeconds: 315_532_800, deltaAt: 19 }, // 1980-01-01
    { unixSeconds: 362_793_600, deltaAt: 20 }, // 1981-07-01
    { unixSeconds: 394_329_600, deltaAt: 21 }, // 1982-07-01
    { unixSeconds: 425_865_600, deltaAt: 22 }, // 1983-07-01
    { unixSeconds: 489_024_000, deltaAt: 23 }, // 1985-07-01
    { unixSeconds: 567_993_600, deltaAt: 24 }, // 1988-01-01
    { unixSeconds: 631_152_000, deltaAt: 25 }, // 1990-01-01
    { unixSeconds: 662_688_000, deltaAt: 26 }, // 1991-01-01
    { unixSeconds: 709_948_800, deltaAt: 27 }, // 1992-07-01
    { unixSeconds: 741_484_800, deltaAt: 28 }, // 1993-07-01
    { unixSeconds: 773_020_800, deltaAt: 29 }, // 1994-07-01
    { unixSeconds: 820_454_400, deltaAt: 30 }, // 1996-01-01
    { unixSeconds: 867_715_200, deltaAt: 31 }, // 1997-07-01
    { unixSeconds: 915_148_800, deltaAt: 32 }, // 1999-01-01
    { unixSeconds: 1_136_073_600, deltaAt: 33 }, // 2006-01-01
    { unixSeconds: 1_230_768_000, deltaAt: 34 }, // 2009-01-01
    { unixSeconds: 1_341_100_800, deltaAt: 35 }, // 2012-07-01
    { unixSeconds: 1_435_708_800, deltaAt: 36 }, // 2015-07-01
    { unixSeconds: 1_483_228_800, deltaAt: 37 }, // 2017-01-01
  ],
  expires: 1_814_140_800, // 2027-06-28
  updated: 1_783_323_897, // 2026-07-06
}
for (const entry of IERS_LEAP_SECONDS.entries) Object.freeze(entry)
Object.freeze(IERS_LEAP_SECONDS.entries)
Object.freeze(IERS_LEAP_SECONDS)

/** TAI − UTC applied before the first table entry (UTC before 1972 used "rubber seconds"; 10 s is the 1972 value). */
export const PRE_1972_DELTA_AT = 10

/**
 * TAI − UTC in effect at the given Unix time (seconds, ignoring leap seconds).
 * At a leap-second boundary the new offset applies from the midnight itself.
 */
export function deltaAtUnixSeconds(
  unixSeconds: number,
  options: { readonly leapSeconds?: LeapSecondTable | undefined } = {},
): number {
  const table = options.leapSeconds ?? IERS_LEAP_SECONDS
  assertValidLeapSecondTable(table)
  const idx = leapEntryIndexForUnix(unixSeconds, table)
  return idx === -1 ? PRE_1972_DELTA_AT : (table.entries[idx]?.deltaAt ?? PRE_1972_DELTA_AT)
}

/** Index of the last entry in effect at `unixSeconds`, or -1 before the table starts. */
export function leapEntryIndexForUnix(unixSeconds: number, table: LeapSecondTable): number {
  let lo = 0
  let hi = table.entries.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const entry = table.entries[mid]
    if (entry !== undefined && entry.unixSeconds <= unixSeconds) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

function tableProblem(entries: readonly LeapSecondEntry[]): string | null {
  if (entries.length === 0) return 'table has no entries'
  for (let i = 0; i < entries.length; i += 1) {
    const cur = entries[i]
    if (cur === undefined) continue
    if (!Number.isSafeInteger(cur.unixSeconds) || !Number.isSafeInteger(cur.deltaAt)) {
      return 'entries must be safe integers'
    }
    if (cur.unixSeconds % SECONDS_PER_DAY !== 0) return 'entries must start at a UTC midnight'
    const prev = entries[i - 1]
    if (prev === undefined) continue
    if (cur.unixSeconds <= prev.unixSeconds) return 'entries are not in ascending order'
    if (Math.abs(cur.deltaAt - prev.deltaAt) !== 1)
      return 'TAI−UTC must change by exactly one second between entries'
  }
  const first = entries[0]
  if (
    first !== undefined &&
    (first.unixSeconds !== UTC_START_SECONDS || first.deltaAt !== PRE_1972_DELTA_AT)
  ) {
    return 'table must start with the canonical 1972-01-01 entry (unixSeconds 63072000, deltaAt 10) to cover the full UTC era'
  }
  return null
}

function metadataProblem(table: LeapSecondTable): string | null {
  if (table.expires !== null && !Number.isSafeInteger(table.expires))
    return 'expires must be a safe integer or null'
  if (
    table.updated !== undefined &&
    table.updated !== null &&
    !Number.isSafeInteger(table.updated)
  ) {
    return 'updated must be a safe integer, null, or absent'
  }
  return tableProblem(table.entries)
}

const isDeeplyFrozen = (table: LeapSecondTable): boolean =>
  Object.isFrozen(table) &&
  Object.isFrozen(table.entries) &&
  table.entries.every((e) => Object.isFrozen(e))

/** Deep-freezes a table (copying when any layer is still mutable). */
export function freezeLeapSecondTable(table: LeapSecondTable): LeapSecondTable {
  if (isDeeplyFrozen(table)) return table
  return Object.freeze({
    entries: Object.freeze(
      table.entries.map((e) => Object.freeze({ unixSeconds: e.unixSeconds, deltaAt: e.deltaAt })),
    ),
    expires: table.expires,
    updated: table.updated ?? null,
  })
}

/**
 * Checks a hand-built table for the invariants the UTC conversions rely on
 * and returns a deeply frozen copy, so identity-keyed caches stay valid.
 */
export function validateLeapSecondTable(
  table: LeapSecondTable,
): Result<LeapSecondTable, LeapSecondTableError> {
  const problem = metadataProblem(table)
  return problem === null
    ? ok(freezeLeapSecondTable(table))
    : err(new LeapSecondTableError(0, problem))
}

const validatedTables = new WeakSet<LeapSecondTable>()

/**
 * Internal: validates a table, throwing `RangeError` when malformed. Results
 * are cached by identity only for deeply frozen tables — a mutable table is
 * re-validated on every use, so post-hoc mutation cannot poison the caches.
 */
export function assertValidLeapSecondTable(table: LeapSecondTable): void {
  if (table === IERS_LEAP_SECONDS || validatedTables.has(table)) return
  const problem = metadataProblem(table)
  if (problem !== null) throw new RangeError(`Invalid leap-second table: ${problem}`)
  if (isDeeplyFrozen(table)) {
    validatedTables.add(table)
  }
}

/** Internal: whether identity-keyed caches may be used for this table. */
export const isCacheableTable = (table: LeapSecondTable): boolean =>
  table === IERS_LEAP_SECONDS || validatedTables.has(table)

/**
 * Parses a leap-second list in either of the two public formats:
 * - IANA/NIST `leap-seconds.list` (`<NTP seconds> <TAI−UTC>` rows, `#@ <expiry>` and `#$ <updated>` lines)
 * - IERS `Leap_Second.dat` (`<MJD> <day> <month> <year> <TAI−UTC>` rows, `#  File expires on` line)
 */
const MAX_LIST_LINES = 10_000

export function parseLeapSecondsList(text: string): Result<LeapSecondTable, LeapSecondTableError> {
  const entries: LeapSecondEntry[] = []
  let expires: number | null = null
  let iersExpires: number | null = null
  let updated: number | null = null
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_LIST_LINES) {
    return err(
      new LeapSecondTableError(MAX_LIST_LINES + 1, `list exceeds ${String(MAX_LIST_LINES)} lines`),
    )
  }
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const lineNo = i + 1
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#@') || line.startsWith('#$')) {
      const ntp = Number(line.slice(2).trim())
      const what = line.startsWith('#@') ? '#@ expiry' : '#$ update stamp'
      if (!Number.isSafeInteger(ntp))
        return err(new LeapSecondTableError(lineNo, `malformed ${what}`))
      if (line.startsWith('#@')) expires = ntp - NTP_TO_UNIX
      else updated = ntp - NTP_TO_UNIX
      continue
    }
    const iersExpiry = /^#\s*File expires on\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i.exec(line)
    if (iersExpiry !== null) {
      const [, day, monthName, year] = iersExpiry
      const month = MONTHS.indexOf((monthName ?? '').slice(0, 3).toLowerCase())
      if (month === -1) return err(new LeapSecondTableError(lineNo, 'unknown month in expiry'))
      iersExpires = Date.UTC(Number(year), month, Number(day)) / 1000
      continue
    }
    if (line.startsWith('#')) continue
    const fields = line.split(/\s+/)
    if (fields.length >= 5 && fields.every((f, idx) => idx > 4 || /^\d+(?:\.\d+)?$/.test(f))) {
      // IERS: MJD DAY MONTH YEAR TAI-UTC — the calendar columns are
      // redundant with the MJD; cross-check them to catch corrupted rows.
      const mjd = Number(fields[0])
      const delta = Number(fields[4])
      const unixSeconds = (mjd - MJD_TO_UNIX_DAYS) * SECONDS_PER_DAY
      const calendar = Date.UTC(Number(fields[3]), Number(fields[2]) - 1, Number(fields[1])) / 1000
      if (calendar !== unixSeconds) {
        return err(
          new LeapSecondTableError(lineNo, 'MJD does not match the day/month/year columns'),
        )
      }
      entries.push({ unixSeconds, deltaAt: delta })
      continue
    }
    if (fields.length >= 2 && /^\d+$/.test(fields[0] ?? '') && /^\d+$/.test(fields[1] ?? '')) {
      entries.push({ unixSeconds: Number(fields[0]) - NTP_TO_UNIX, deltaAt: Number(fields[1]) })
      continue
    }
    return err(new LeapSecondTableError(lineNo, `unrecognised line ${JSON.stringify(raw)}`))
  }
  if (entries.length === 0) return err(new LeapSecondTableError(0, 'no leap-second entries found'))
  const table = { entries, expires: expires ?? iersExpires, updated }
  const problem = metadataProblem(table)
  if (problem !== null) return err(new LeapSecondTableError(lines.length, problem))
  return ok(freezeLeapSecondTable(table))
}

const MONTHS: readonly string[] = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]
