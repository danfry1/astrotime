/**
 * Fails when the bundled IERS leap-second table no longer matches the live
 * IANA list, or when its Bulletin C expiry is less than 90 days away.
 * Run monthly in CI (.github/workflows/leap-seconds.yml).
 */
import { IERS_LEAP_SECONDS, parseLeapSecondsList, unwrap } from '../src/index.js'

const SOURCE = 'https://data.iana.org/time-zones/data/leap-seconds.list'
const WARN_WINDOW_SECONDS = 90 * 86_400

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`Fetching ${SOURCE} failed: ${String(response.status)}`)
const live = unwrap(parseLeapSecondsList(await response.text()))

const entriesMatch = JSON.stringify(live.entries) === JSON.stringify(IERS_LEAP_SECONDS.entries)
const expiryMatches = live.expires === IERS_LEAP_SECONDS.expires
const expiringSoon =
  IERS_LEAP_SECONDS.expires !== null &&
  IERS_LEAP_SECONDS.expires - Date.now() / 1000 < WARN_WINDOW_SECONDS

if (!entriesMatch || !expiryMatches || expiringSoon) {
  console.error(
    JSON.stringify(
      {
        entriesMatch,
        expiryMatches,
        expiringSoon,
        bundledExpires: IERS_LEAP_SECONDS.expires,
        liveExpires: live.expires,
        liveUpdated: live.updated ?? null,
      },
      null,
      2,
    ),
  )
  console.error('Update IERS_LEAP_SECONDS in src/leap-seconds.ts and release a patch version.')
  process.exit(1)
}
console.log(
  `Bundled leap-second table matches IANA (${String(IERS_LEAP_SECONDS.entries.length)} entries); expires ${new Date((IERS_LEAP_SECONDS.expires ?? 0) * 1000).toISOString()}`,
)
