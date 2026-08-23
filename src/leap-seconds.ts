import { LeapSecondTableError } from './errors.js'
import { err, ok, type Result } from './result.js'
import { sha1Hex } from './sha1.js'
import { assertOptionsObject } from './options.js'
import { daysInMonth } from './calendar.js'

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
 * TAI − UTC in effect at the given finite Unix time (seconds, ignoring leap seconds).
 * At a leap-second boundary the new offset applies from the midnight itself.
 */
export function deltaAtUnixSeconds(
  unixSeconds: number,
  options: { readonly leapSeconds?: LeapSecondTable | undefined } = {},
): number {
  assertOptionsObject(options, 'deltaAtUnixSeconds')
  if (!Number.isFinite(unixSeconds))
    throw new RangeError(`Unix seconds must be finite, got ${String(unixSeconds)}`)
  let table = IERS_LEAP_SECONDS
  if (options.leapSeconds !== undefined) table = options.leapSeconds
  assertValidLeapSecondTable(table)
  const idx = leapEntryIndexForUnix(unixSeconds, table)
  return idx === -1 ? PRE_1972_DELTA_AT : table.entries[idx]!.deltaAt
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

function tableProblem(entries: readonly unknown[]): string | null {
  if (entries.length === 0) return 'table has no entries'
  for (let i = 0; i < entries.length; i += 1) {
    const value = entries[i]
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return 'entries must be objects with unixSeconds and deltaAt fields'
    }
    const cur = value as Partial<LeapSecondEntry>
    const unixSeconds = cur.unixSeconds
    const deltaAt = cur.deltaAt
    if (
      typeof unixSeconds !== 'number' ||
      typeof deltaAt !== 'number' ||
      !Number.isSafeInteger(unixSeconds) ||
      !Number.isSafeInteger(deltaAt)
    ) {
      return 'entries must be safe integers'
    }
    if (!Number.isSafeInteger(unixSeconds + deltaAt)) {
      return 'entry TAI boundaries must be safe integers'
    }
    if (unixSeconds % SECONDS_PER_DAY !== 0) return 'entries must start at a UTC midnight'
    const previousValue = entries[i - 1]
    if (previousValue === undefined) continue
    const prev = previousValue as LeapSecondEntry
    if (unixSeconds <= prev.unixSeconds) return 'entries are not in ascending order'
    if (Math.abs(deltaAt - prev.deltaAt) !== 1)
      return 'TAI−UTC must change by exactly one second between entries'
  }
  // The full known history is required: every bundled entry must appear
  // verbatim, in order, before any appended entries. A partial snapshot
  // would silently misapply older ΔAT values to modern epochs.
  const known = IERS_LEAP_SECONDS.entries
  if (entries.length < known.length) {
    return `table must include the complete known leap-second history (got ${String(entries.length)} of ${String(known.length)} known entries)`
  }
  for (let i = 0; i < known.length; i += 1) {
    // Both indexes are proven by the length guard above and this loop bound.
    const expected = known[i]!
    const given = entries[i] as LeapSecondEntry
    if (given.unixSeconds !== expected.unixSeconds || given.deltaAt !== expected.deltaAt) {
      return `entry ${String(i)} must match the known leap-second history (expected unixSeconds ${String(expected.unixSeconds)}, deltaAt ${String(expected.deltaAt)})`
    }
  }
  // Appended entries must lie in the genuinely unknown future: the bundled
  // data is authoritative through its expiry, so an "extra" leap second
  // dated inside that window would contradict known history.
  const firstAppended = entries[known.length] as LeapSecondEntry | undefined
  const coverageBoundary = IERS_LEAP_SECONDS.expires
  if (
    firstAppended !== undefined &&
    coverageBoundary !== null &&
    firstAppended.unixSeconds < coverageBoundary
  ) {
    return `appended entries must not predate the known history's coverage boundary (${String(coverageBoundary)})`
  }
  return null
}

function metadataProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'table must be an object'
  }
  const candidate = value as Partial<LeapSecondTable>
  if (!Array.isArray(candidate.entries)) return 'entries must be an array'
  const table = candidate as LeapSecondTable
  if (table.expires !== null && !Number.isSafeInteger(table.expires))
    return 'expires must be a safe integer or null'
  if (
    table.updated !== undefined &&
    table.updated !== null &&
    !Number.isSafeInteger(table.updated)
  ) {
    return 'updated must be a safe integer, null, or absent'
  }
  const problem = tableProblem(table.entries)
  if (problem !== null) return problem
  // tableProblem rejected an empty table, so the final entry is proven.
  const last = table.entries.at(-1)!
  if (table.expires !== null && table.expires <= last.unixSeconds) {
    return 'expires must be later than the final leap-second entry'
  }
  if (
    table.updated !== undefined &&
    table.updated !== null &&
    table.expires !== null &&
    table.updated > table.expires
  ) {
    return 'updated must not be later than expires'
  }
  return null
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

type LeapListState = {
  readonly entries: LeapSecondEntry[]
  expires: number | null
  iersExpires: number | null
  updated: number | null
  integrityHash: { readonly value: string; readonly line: number } | null
  hasIanaExpiry: boolean
  hasIersExpiry: boolean
  hasUpdated: boolean
  updatedDigits: string
  expiresDigits: string
  pairDigits: string
  sawIanaRow: boolean
  sawIersRow: boolean
}

/** `undefined` means this handler did not recognise the line; `null` means success. */
type LineOutcome = LeapSecondTableError | null | undefined

function parseIanaStamp(state: LeapListState, line: string, lineNo: number): LineOutcome {
  if (!line.startsWith('#@') && !line.startsWith('#$')) return undefined
  const stamp = line.slice(2).trim()
  const ntp = Number(stamp)
  const isExpiry = line.startsWith('#@')
  const what = isExpiry ? '#@ expiry' : '#$ update stamp'
  if (!/^\d+$/.test(stamp) || !Number.isSafeInteger(ntp)) {
    return new LeapSecondTableError(lineNo, `malformed ${what}`)
  }
  if (isExpiry) {
    if (state.hasIanaExpiry) return new LeapSecondTableError(lineNo, 'duplicate #@ expiry')
    state.hasIanaExpiry = true
    state.expires = ntp - NTP_TO_UNIX
    state.expiresDigits = stamp
  } else {
    if (state.hasUpdated) return new LeapSecondTableError(lineNo, 'duplicate #$ update stamp')
    state.hasUpdated = true
    state.updated = ntp - NTP_TO_UNIX
    state.updatedDigits = stamp
  }
  return null
}

function parseIersExpiry(state: LeapListState, line: string, lineNo: number): LineOutcome {
  if (!/^#\s*File expires on\b/i.test(line)) return undefined
  const match = /^#\s*File expires on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i.exec(line)
  if (match === null) return new LeapSecondTableError(lineNo, 'malformed IERS expiry')
  if (state.hasIersExpiry) return new LeapSecondTableError(lineNo, 'duplicate IERS expiry')
  state.hasIersExpiry = true
  const [, day, monthName, year] = match
  const month = MONTHS.indexOf(monthName!.slice(0, 3).toLowerCase())
  if (month === -1) return new LeapSecondTableError(lineNo, 'unknown month in expiry')
  const expirySeconds = strictUtcDateSeconds(Number(year), month + 1, Number(day))
  if (expirySeconds === null) return new LeapSecondTableError(lineNo, 'expiry date does not exist')
  state.iersExpires = expirySeconds
  return null
}

function parseIntegrityHash(state: LeapListState, line: string, lineNo: number): LineOutcome {
  if (!line.startsWith('#h')) return undefined
  if (state.integrityHash !== null) {
    return new LeapSecondTableError(lineNo, 'duplicate #h integrity record')
  }
  const words = line.slice(2).trim().split(/\s+/)
  if (words.length !== 5 || words.some((word) => !/^[0-9a-fA-F]{1,8}$/.test(word))) {
    return new LeapSecondTableError(lineNo, 'malformed #h integrity record')
  }
  state.integrityHash = {
    value: words.map((word) => word.toLowerCase().padStart(8, '0')).join(''),
    line: lineNo,
  }
  return null
}

function parseLeapDataRow(state: LeapListState, line: string, lineNo: number): LineOutcome {
  const iersRow = /^(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-]?\d+)(?:\s+#.*)?$/.exec(line)
  if (iersRow !== null) {
    const mjd = Number(iersRow[1])
    const delta = Number(iersRow[5])
    const unixSeconds = (mjd - MJD_TO_UNIX_DAYS) * SECONDS_PER_DAY
    const calendar = strictUtcDateSeconds(
      Number(iersRow[4]),
      Number(iersRow[3]),
      Number(iersRow[2]),
    )
    if (calendar === null) {
      return new LeapSecondTableError(lineNo, 'day/month/year columns are not a real date')
    }
    if (calendar !== unixSeconds) {
      return new LeapSecondTableError(lineNo, 'MJD does not match the day/month/year columns')
    }
    if (state.sawIanaRow) {
      return new LeapSecondTableError(lineNo, 'cannot mix IANA and IERS data rows')
    }
    state.sawIersRow = true
    state.entries.push({ unixSeconds, deltaAt: delta })
    return null
  }

  const ianaRow = /^(\d+)\s+([+-]?\d+)(?:\s+#.*)?$/.exec(line)
  if (ianaRow === null) return undefined
  if (state.sawIersRow) {
    return new LeapSecondTableError(lineNo, 'cannot mix IANA and IERS data rows')
  }
  state.sawIanaRow = true
  state.entries.push({
    unixSeconds: Number(ianaRow[1]) - NTP_TO_UNIX,
    deltaAt: Number(ianaRow[2]),
  })
  state.pairDigits += `${ianaRow[1]}${ianaRow[2]}`
  return null
}

function parseLeapListLine(
  state: LeapListState,
  raw: string,
  lineNo: number,
): LeapSecondTableError | null {
  const line = raw.trim()
  if (line === '') return null
  for (const handler of [parseIanaStamp, parseIersExpiry, parseIntegrityHash]) {
    const outcome = handler(state, line, lineNo)
    if (outcome !== undefined) return outcome
  }
  if (line.startsWith('#')) return null
  const data = parseLeapDataRow(state, line, lineNo)
  return data === undefined
    ? new LeapSecondTableError(lineNo, `unrecognised line ${JSON.stringify(raw)}`)
    : data
}

function finishLeapList(
  state: LeapListState,
  lineCount: number,
): Result<LeapSecondTable, LeapSecondTableError> {
  if (state.entries.length === 0) {
    return err(new LeapSecondTableError(0, 'no leap-second entries found'))
  }
  if (state.integrityHash !== null) {
    if (!state.hasUpdated || !state.hasIanaExpiry || !state.sawIanaRow || state.sawIersRow) {
      return err(
        new LeapSecondTableError(
          state.integrityHash.line,
          'an IANA #h integrity record requires #$, #@ and IANA data rows',
        ),
      )
    }
    // IANA/NIST '#h': SHA-1 over the ASCII digits of the '#$' stamp, the
    // '#@' stamp, then each (timestamp, ΔAT) pair, with no separators.
    const computed = sha1Hex(state.updatedDigits + state.expiresDigits + state.pairDigits)
    if (computed !== state.integrityHash.value) {
      return err(
        new LeapSecondTableError(
          state.integrityHash.line,
          'integrity hash (#h) does not match the file contents',
        ),
      )
    }
  }
  const table = {
    entries: state.entries,
    expires: state.expires ?? state.iersExpires,
    updated: state.updated,
  }
  const problem = metadataProblem(table)
  return problem === null
    ? ok(freezeLeapSecondTable(table))
    : err(new LeapSecondTableError(lineCount, problem))
}

export function parseLeapSecondsList(text: string): Result<LeapSecondTable, LeapSecondTableError> {
  const state: LeapListState = {
    entries: [],
    expires: null,
    iersExpires: null,
    updated: null,
    integrityHash: null,
    hasIanaExpiry: false,
    hasIersExpiry: false,
    hasUpdated: false,
    updatedDigits: '',
    expiresDigits: '',
    pairDigits: '',
    sawIanaRow: false,
    sawIersRow: false,
  }
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_LIST_LINES) {
    return err(
      new LeapSecondTableError(MAX_LIST_LINES + 1, `list exceeds ${String(MAX_LIST_LINES)} lines`),
    )
  }
  for (let i = 0; i < lines.length; i += 1) {
    const problem = parseLeapListLine(state, lines[i]!, i + 1)
    if (problem !== null) return err(problem)
  }
  return finishLeapList(state, lines.length)
}

/** Date.UTC seconds for a calendar date, or null when the date does not exist. */
function strictUtcDateSeconds(year: number, month: number, day: number): number | null {
  // Callers obtain all three values from decimal-only regular-expression
  // captures. Keep each range decision independent so safety coverage can
  // demonstrate every condition without relying on Date's normalization.
  if (year < 1900) return null
  if (year > 2400) return null
  if (month < 1) return null
  if (month > 12) return null
  if (day < 1) return null
  if (day > daysInMonth(year, month)) return null
  return Date.UTC(year, month - 1, day) / 1000
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
