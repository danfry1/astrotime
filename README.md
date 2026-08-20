# astrotime

Zero-dependency spacecraft & astronomy time for TypeScript.

- **Exact instants** — `bigint` nanoseconds on the TAI timeline; arithmetic never drifts, never skips, never double-counts a leap second.
- **Leap-second-aware UTC** — `23:59:60` is a real, validated time; the IERS table ships in the box and can be replaced at runtime from `leap-seconds.list` / `Leap_Second.dat`.
- **Time scales** — UTC, TAI, TT, GPS, TDB; seconds since J2000 (SPICE-style ET), Julian / Modified Julian dates (single and two-part, SOFA quasi-JD for UTC), GPS week/seconds-of-week.
- **Strict parse & format** — ISO 8601 calendar and ordinal (day-of-year / "SCET") forms with 1–9 fraction digits, UTC offsets and scale designators (`… TAI`); small token patterns (`YYYY-DDDTHH:mm:ss.SSSSSS`); ISO 8601 and clock durations.
- **Correct by reference** — conversions are tested against [astropy](https://www.astropy.org/) (ERFA/SOFA) golden vectors: every inserted leap second since 1972 probed at ±1 ns, plus hundreds of random instants, plus fast-check round-trip properties.
- **Small and fast** — ~17 KB gzipped, tree-shakeable, no runtime dependencies; ~3M pattern formats/s and ~3.5M ISO parses/s on a laptop — on par with native `Date#toISOString`, and well ahead of moment/luxon/date-fns for pattern work. Works in browsers, Node ≥ 22, Bun, Deno and React Native ≥ 0.70 (Hermes).

```ts
import { parseInstantOrThrow, formatIso, formatOrdinal, durationBetween, durationToSeconds } from 'astrotime'

const leap = parseInstantOrThrow('2016-12-31T23:59:60.5Z')
formatIso(leap, { scale: 'tai' }) // '2017-01-01T00:00:36.500 TAI'
formatOrdinal(leap)               // '2016-366T23:59:60.500'

const next = parseInstantOrThrow('2017-01-01T00:00:00.5Z')
durationToSeconds(durationBetween(leap, next)) // 1  (a Date-based subtraction says 0)
```

## Install

```sh
npm install astrotime
pnpm add astrotime
yarn add astrotime
bun add astrotime
deno add npm:astrotime
```

## Why

JavaScript has no equivalent of `astropy.time`. Mission-control and ground-station UIs in JS
(Open MCT, Aerie, cubesat dashboards, satellite trackers) tend to push `ms since epoch`
around and reach for `moment` or `luxon` for formatting, which means:

- no microsecond/nanosecond telemetry timestamps,
- no TAI / TT / GPS, so `Date` subtraction across a leap second is wrong by a second,
- no day-of-year (`2026-231T12:34:56`) parsing without hand-rolled regexes,
- leap-second tables hardcoded and forgotten.

`astrotime` is the small, typed, dependency-free piece that fixes those four things — and nothing else.
Time zones and locale formatting are deliberately left to `Intl` (see [Interop](#interop)).
The model (uniform-scale epoch + integer nanoseconds + explicit scales) is the same one used by
astropy, SOFA/ERFA, Rust's hifitime and Orekit's `AbsoluteDate`.

## Which scale do I want?

| You have / need | Use |
|---|---|
| Telemetry timestamps, logs, anything user-facing | `utc` |
| Elapsed time, intervals, rates | `Duration` (or `tai`) |
| Ephemerides, SPICE ET, orbit propagation | `tdb` (or `tt`) |
| GPS receivers, RINEX, week/seconds-of-week | `gps` |
| Astronomy epochs, Julian dates | the scale your source says (be explicit) |

## Concepts

| Type | What it is |
|---|---|
| `Instant` | A point in time: nanoseconds since `1970-01-01T00:00:00 TAI`. Immutable, frozen; `JSON.stringify`/`String()` give the canonical ns-precision UTC ISO string. |
| `Duration` | Signed nanoseconds of elapsed SI time. Days are exactly 86 400 s. No months/years. Serializes as ISO 8601 (`PT1H30M`). |
| `CivilDateTime` | Broken-down time (`year, month, day, dayOfYear, hour, minute, second (0–60), nanosecond`). |
| `CivilFields` | Input fields: `{ year, month, day }` or `{ year, dayOfYear }` plus optional time. |
| `LeapSecondTable` | `{ entries: [{ unixSeconds, deltaAt }], expires, updated }` — TAI−UTC history. |
| `TimeScale` | `'utc' \| 'tai' \| 'tt' \| 'gps' \| 'tdb'` |

**Errors:** expected failures (parsing, invalid fields) return a `Result<T, E>`
rather than throwing — malformed timestamps are ordinary data in a telemetry
stream, and the type system then forces you to handle them:

```ts
const result = parseInstant(userInput) // Result<Instant, TimeParseError | InvalidTimeError>
if (result.ok) {
  formatIso(result.value)              // .value only exists after the .ok check
} else {
  console.warn(result.error.code, result.error.message) // typed: TimeParseError | InvalidTimeError
}
```

Each error carries a stable `code`, structured fields and `toJSON()`
(`TimeParseError`, `InvalidTimeError`, `LeapSecondTableError`). When you'd
rather throw — one-off scripts, inputs you already trust, or plain JavaScript
without the compiler enforcing the `.ok` check — use `parseInstantOrThrow` /
`parseDurationOrThrow`, or `unwrap(result)` / `unwrapOr(result, fallback)`.
Programmer errors (non-finite numbers, malformed hand-built tables) always
throw `RangeError`.

## Usage

### Parse and format

```ts
import { parseInstant, parseInstantOrThrow, formatInstant, formatIso, formatOrdinal, isValidInstant } from 'astrotime'

// ISO 8601 calendar or ordinal, optional time, 1–9 fraction digits,
// Z / ±HH:mm offsets, or a scale designator
parseInstant('2026-08-19T12:34:56.789012345Z')
parseInstant('2026-231T12:34:56.789')        // day-of-year ("SCET"-style)
parseInstant('2026-08-19T13:34:56+01:00')
parseInstant('2017-01-01T00:00:37 TAI')      // scale designators parse back
parseInstant('2026-08-19')                   // midnight UTC

// Only the ordinal form
parseInstant('2026-231', { format: 'ordinal' })

// Strict token patterns (YYYY MM DD DDD HH mm ss S…S Z [literal])
parseInstant('2026-08-19 12:34:56.789', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })
isValidInstant('2026-08-19 12:34', { format: 'YYYY-MM-DD HH:mm' }) // true

// Other scales: the text is read on that scale's clock
parseInstant('2017-01-01T00:00:37', { scale: 'tai' }) // == 2017-01-01T00:00:00Z

const i = parseInstantOrThrow('2026-08-19T12:34:56.789012Z')
formatIso(i)                                      // '2026-08-19T12:34:56.789Z'
formatIso(i, { precision: 'auto' })               // '2026-08-19T12:34:56.789012Z'
formatIso(i, { scale: 'tt', precision: 'nanos' }) // '2026-08-19T12:36:05.973012000 TT'
formatIso(i, { scale: 'tt', designator: 'none' }) // '2026-08-19T12:36:05.973'
formatOrdinal(i)                                  // '2026-231T12:34:56.789'
formatInstant(i, 'YYYY-DDD[T]HH:mm:ss.SSSSSS')    // '2026-231T12:34:56.789012'
```

Non-UTC ISO output carries its scale (`… TT`) by default so the string is never
ambiguous, and `parseInstant` accepts it back — the convention SPICE, astropy and
Orekit use. Fractions are truncated, not rounded, when digits are dropped.

### Unix time, `Date`, now

```ts
import { instantFromUnixMillis, instantToUnixMillis, instantFromDate, instantToDate, instantNow } from 'astrotime'

const i = instantFromUnixMillis(Date.now())
instantToUnixMillis(i)             // POSIX ms (sub-ms kept as a fraction)
instantToDate(i)                   // nearest Date
instantFromDate(new Date())
instantNow()                       // from Date.now() (ms precision); pass { now } to inject a clock
```

POSIX Unix time cannot represent a leap second, so during `23:59:60.x` the
functions return the same values as `00:00:00.x` of the next day, and
`instantToDate` of a leap second renders as that next second. The reverse
direction is never ambiguous. (UTC Julian dates do **not** do this — see below.)

### UTC fields and leap seconds

```ts
import { instantFromUtc, instantToUtc, deltaAt, isLeapSecond, isUtcDefined, unwrap } from 'astrotime'

const leap = instantFromUtc({ year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 }) // ok: true
instantFromUtc({ year: 2016, month: 12, day: 30, hour: 23, minute: 59, second: 60 })
// { ok: false, error: InvalidTimeError('second', 60, 'no leap second is inserted at this time') }

instantFromUtc({ year: 2024, dayOfYear: 366, hour: 6 }) // ordinal input

instantToUtc(unwrap(leap))
// { year: 2016, month: 12, day: 31, dayOfYear: 366, hour: 23, minute: 59, second: 60, nanosecond: 0 }

deltaAt(unwrap(leap))        // 36  (TAI − UTC in effect; 37 from 2017-01-01)
isLeapSecond(unwrap(leap))   // true
```

Negative leap seconds (a deleted `23:59:59`) are validated too, should the IERS ever announce one.

UTC is only defined from 1972. Earlier instants are approximated with
TAI − UTC = 10 s by default; pass `{ before1972: 'reject' }` to get an
`InvalidTimeError` instead, and use `isUtcDefined(i)` to test.

### Time scales, J2000, Julian dates, GPS

```ts
import {
  instantToJ2000Seconds, instantFromJ2000Seconds, instantToJulianDate, instantToJulianDateParts,
  instantToModifiedJulianDate, instantFromJulianDate, instantToGpsWeek, instantFromGpsWeek,
  instantToCivil, J2000_INSTANT, GPS_EPOCH_INSTANT,
} from 'astrotime'

instantToJ2000Seconds(i, 'tdb')       // 840414965.97… — SPICE "ET" seconds past J2000
instantToJ2000Seconds(i, 'tt')
instantFromJ2000Seconds(8.4e8, 'tdb')

instantToJulianDate(i, 'utc')         // 2461272.0242…  (≈50 µs float resolution)
instantToJulianDateParts(i, 'tt')     // { jd1: 2461271.5, jd2: 0.52506… } (full precision)
instantToModifiedJulianDate(i, 'tai') // 61271.5246…
instantFromJulianDate(2451545.0, 'tt') // J2000

instantToGpsWeek(i)                   // { week: 2432, secondsOfWeek: 304514.789012 }
instantFromGpsWeek(2432, 304514.789012)

instantToCivil(i, 'tai')              // broken-down TAI clock reading
formatIso(J2000_INSTANT)              // '2000-01-01T11:58:55.816Z'
formatIso(GPS_EPOCH_INSTANT)          // '1980-01-06T00:00:00.000Z'
```

The `scale` argument is required on all of these — a Julian date without a
stated scale is a bug waiting to happen. UTC Julian dates follow the SOFA/ERFA
quasi-JD convention (a leap-second day is 86 401 s long), so they are monotonic
and match astropy on leap days.

Definitions: TT = TAI + 32.184 s; GPS = TAI − 19 s; TDB = TT + the three leading
periodic terms of the Fairhead & Bretagnon series (USNO Circular 179 eq. 2.6,
< 30 µs vs ERFA's full series, 1972–2100).

### Durations

```ts
import { duration, parseDuration, formatDuration, durationToComponents, addDuration } from 'astrotime'

const d = duration({ days: 1, hours: 2, minutes: 3, seconds: 4.5 })
formatDuration(d)                     // 'P1DT2H3M4.5S'
formatDuration(d, 'clock')            // '26:03:04'   (hours absorb days)
formatDuration(d, 'D[d] HH:mm:ss.SSS')// '1d 02:03:04.500'

parseDuration('PT90M')                // ISO 8601
parseDuration('1T02:03:04.005')       // day-count prefix + clock time
parseDuration('36:00:00')             // clock, hours unbounded
durationToComponents(d)               // { sign: 1, days: 1, hours: 2, minutes: 3, seconds: 4, nanos: 500000000 }

addDuration(i, d)
```

### Ordering, ranges, truncation

```ts
import { compareInstants, isBefore, minInstant, clampInstant, instantRange, truncateInstant, duration } from 'astrotime'

;[...instantRange(start, end, duration({ minutes: 10 }))] // plot ticks
truncateInstant(i, 'day', 'utc')    // start of UTC day (scale-aware: TAI days differ by ΔAT)
truncateInstant(i, 'hour', 'gps')
sorted.sort(compareInstants)
```

### Keeping the leap-second table fresh

The bundled table is current as of its `updated` stamp and valid until `expires`
(IERS Bulletin C). A monthly CI job in this repo fails if it drifts from IANA,
and every UTC-dependent function takes `{ leapSeconds }` — no global state:

```ts
import { IERS_LEAP_SECONDS, isLeapSecondTableExpired, parseLeapSecondsList, formatIso, instantNow, unwrap } from 'astrotime'

if (isLeapSecondTableExpired(IERS_LEAP_SECONDS, instantNow())) {
  const text = await (await fetch('https://data.iana.org/time-zones/data/leap-seconds.list')).text()
  const leapSeconds = unwrap(parseLeapSecondsList(text)) // also accepts IERS Leap_Second.dat
  formatIso(someInstant, { leapSeconds })
}
```

### Serialization

`Instant` and `Duration` are frozen objects with `toJSON`, so `JSON.stringify`
just works (`"2026-08-19T12:34:56.789012345Z"`, `"PT1H30M"`), and
`parseInstant` / `parseDuration` read those forms back losslessly. For binary
protocols use `instantToTaiNanos(i)` / `instantFromTaiNanos(n)` (a `bigint`).

## Interop

- **Time zones / locales**: `new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', … }).format(instantToDate(i))`.
- **Temporal**: `Temporal.Instant.fromEpochNanoseconds(instantToUnixNanos(i))` and back via `instantFromUnixNanos`.
- **satellite.js / TLE**: feed `instantToDate(i)` to `propagate`; use `instantToGpsWeek` / `instantToJ2000Seconds` for epochs.
- **Open MCT**: a `TimeSystem` formatter needs only `formatInstant` / `parseInstant` — see `examples/openmct-utc-time-format.js`.

## Precision & limits

- `Instant` and `Duration` are exact to 1 ns at any magnitude (`bigint`); civil/ISO conversions accept years −999 999 … +999 999.
- Functions returning a float `number` carry double resolution (~0.1 µs for J2000 seconds today; ~50 µs for a single-float Julian date — use the two-part form).
- `instantNow()` has millisecond precision (it reads `Date.now()`); nanosecond precision applies to stored and parsed timestamps.
- UTC before 1972 is approximated with TAI − UTC = 10 s (the real pre-1972 "rubber second" UTC is out of scope); opt into rejection with `before1972: 'reject'`.
- UT1 / ΔT, SCLK and SPICE kernels are out of scope.

## Development

```sh
bun install
bun run test            # vitest: astropy golden + drift vectors, fast-check properties
bun run bench           # vitest benchmarks
bun run check:release   # format, lint, knip, typecheck, coverage, packed-package smoke test
pip install astropy==6.0.1
python3 scripts/generate-golden.py > tests/fixtures/astropy-golden.json  # regenerate reference data
python3 scripts/generate-drift.py  > tests/fixtures/astropy-drift.json
```

## License

MIT
