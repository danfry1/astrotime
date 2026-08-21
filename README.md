# astrotime

[![CI](https://github.com/danfry1/astrotime/actions/workflows/ci.yml/badge.svg)](https://github.com/danfry1/astrotime/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/astrotime.svg)](https://www.npmjs.com/package/astrotime)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)
[![provenance](https://img.shields.io/badge/npm-SLSA%20provenance-blue.svg)](https://www.npmjs.com/package/astrotime#provenance)
[![verified against astropy + CSPICE](https://img.shields.io/badge/verified-astropy%20%2B%20CSPICE-8a2be2.svg)](#why-you-can-trust-the-numbers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Zero-dependency spacecraft & astronomy time for TypeScript.

- **Exact instants** — `bigint` nanoseconds on the TAI timeline; arithmetic never drifts, never skips, never double-counts a leap second.
- **Leap-second-aware UTC** — `23:59:60` is a real, validated time; the IERS table ships in the box and can be replaced at runtime from `leap-seconds.list` / `Leap_Second.dat` (with `#h` integrity verification).
- **Time scales** — UTC, TAI, TT, GPS, TDB; seconds since J2000 with per-scale origins (`tdb` follows the SPICE ET convention: exact epoch, approximate TDB model — < 30 µs vs CSPICE over 1972–2100), Julian / Modified Julian dates (single and two-part, SOFA quasi-JD for UTC), GPS week/seconds-of-week.
- **Strict parse & format** — ISO 8601 calendar and ordinal (day-of-year / "SCET") forms with 1–9 fraction digits, UTC offsets and scale designators (`… TAI`); small token patterns (`YYYY-DDDTHH:mm:ss.SSSSSS`); ISO 8601 and clock durations.
- **Correct by reference** — conversions are tested against [astropy](https://www.astropy.org/) (ERFA/SOFA) *and* NAIF [CSPICE](https://naif.jpl.nasa.gov/naif/toolkit.html) golden vectors: every inserted leap second since 1972 probed at ±1 ns, SPICE ET epochs, pairwise elapsed-TAI cross-checks against `naif0012.tls`, plus fast-check round-trip properties and an adversarial suite (mutable tables, negative leaps, stale data, pathological input).
- **Deterministic** — bit-identical output on V8, JavaScriptCore *and* Hermes (no `Math.sin` variance: the TDB series uses a built-in deterministic sine), enforced by cross-engine digests in CI.
- **Small and fast** — ~20 KB gzipped, tree-shakeable, no runtime dependencies; ~3M pattern formats/s and ~3.5M ISO parses/s on a laptop — on par with native `Date#toISOString`, and well ahead of moment/luxon/date-fns for pattern work. CI-verified on Node ≥ 22, Bun, and Hermes (React Native ≥ 0.70, where BigInt became available) — the Hermes check runs the real engine after the same Babel transform Metro applies. Plain ES2022 with zero dependencies, so browsers and Deno are supported targets too.

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

## Why you can trust the numbers

Time libraries are easy to write and hard to get right, so every claim here
is backed by something you can re-run:

| Claim | How it is checked |
|---|---|
| Conversions match the reference implementations | Golden vectors from **astropy** (ERFA/SOFA) and **NAIF CSPICE**, committed to the repo, plus a monthly **differential sweep of 100 000 random instants** against astropy — currently zero mismatches |
| Every leap second is handled, including the awkward ones | Every inserted leap second since 1972 probed at ±1 ns; negative leap seconds (never yet announced) exercised across Unix, Julian dates, truncation and ranges |
| Output is identical everywhere | A 110 000-value digest is compared across **V8, JavaScriptCore and Hermes** (the React Native engine) — the TDB series uses a built-in deterministic sine because `Math.sin` is not specified bit-exactly |
| The documentation is true | 34 documented requirements are mapped to the tests that verify them in [`REQUIREMENTS.md`](REQUIREMENTS.md); CI fails if a requirement loses its test |
| The tests would notice a bug | Mutation testing (86.6%) with a published [survivor analysis](ASSURANCE-ROADMAP.md#mutation-scores), rather than coverage alone |
| The published package is the source | Reproducible `npm pack` shasum, SLSA provenance, signed tags, and an [evidence bundle](https://github.com/danfry1/astrotime/releases) attached to every release |
| Leap-second data stays current | A monthly job compares the bundled table with IANA and fails on drift; `#h` integrity records are verified when parsing |

The library is scoped for **ground tooling** — displays, planning, analysis.
It is not certified for flight, navigation or command paths; see
[`ASSURANCE-ROADMAP.md`](ASSURANCE-ROADMAP.md) for exactly what that means.

## Choosing a time library

Most projects should **not** use astrotime. Use it when leap seconds or
non-UTC time scales actually matter to you:

| | astrotime | Temporal | Luxon / date-fns | Moment |
|---|---|---|---|---|
| Sub-millisecond precision | ✅ nanosecond | ✅ nanosecond | ❌ millisecond | ❌ millisecond |
| Leap seconds (`23:59:60`) | ✅ validated | ❌ ignored by design | ❌ | ❌ |
| TAI / TT / GPS / TDB scales | ✅ | ❌ | ❌ | ❌ |
| Julian dates, day-of-year, SPICE ET | ✅ | ❌ | partial (ordinal only) | partial |
| Time zones & locale formatting | ❌ use `Intl` | ✅ | ✅ | ✅ |
| Calendar arithmetic (add a month) | ❌ out of scope | ✅ | ✅ | ✅ |
| Available today without a polyfill | ✅ | partial | ✅ | ✅ (maintenance mode) |

**Use Temporal or Luxon** if you want zones, locales and calendar maths and
your timestamps are wall-clock civil time. **Use astrotime** — possibly
alongside them — if a second matters across a leap boundary, if you need
TAI/TT/GPS/TDB, or if your telemetry is finer than a millisecond. They
compose: `Temporal.Instant.fromEpochNanoseconds(instantToUnixNanos(i))`.

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

Formatting **rejects a pattern it cannot render faithfully** rather than
quietly producing something else, on the same principle as the year-range
check: a plausible-but-wrong string is worse than an error. Use `[text]` for
a literal. A bug of exactly this shape — `'.ms'` where `.SSS` was meant — sat
in NASA Open MCT's notification timestamps for years.

```ts
formatInstant(i, 'YYYY-MM-DD HH:mm:ss.SSS')   // fine
formatInstant(i, 'YYYY-MM-DD[T]HH:mm:ss[Z]')  // fine — bracketed text is a literal
formatInstant(i, 'YYYY-MM-DD hh:mm:ss.ms')    // RangeError: unknown token(s) "hh", "ms"
formatInstant(i, 'YYYY-MM-DDTHH:mm:ss')       // RangeError: unknown token(s) "T"
formatInstant(i, 'YYYY [MM')                  // RangeError: unterminated "["
formatInstant(i, 'HH:mm:ss.SSSSSSSSSS')       // RangeError: longer than the longest "S" token
formatInstant(i, 'YYYY-MM-DD DD')             // RangeError: field "DD" appears more than once
```

The last two are the quiet ones. Ten `S`es split into a nine-digit token
plus a one-digit token and rendered `.7890000007`, which reads back as
`.700000000`; and a repeated field printed the same number twice. Both
produced a string that looked right. `DD` and `DDD` are different fields
that share a letter, so a pattern may legitimately carry both, and
`parseInstant` checks that they agree.

A parse pattern is held to the same standard, and a defect in it throws
rather than reporting the *text* as unparseable — the pattern comes from
your source, the text does not. Parsing asks more of a pattern than
formatting does, so it has its own check: `'HH:mm'` renders perfectly well
and names no instant to read back.

```ts
import { parsePatternError } from 'astrotime'

parsePatternError('YYYY-MM-DD HH:mm') // null
parsePatternError('HH:mm')            // 'no year (YYYY), so it cannot identify a date'
parsePatternError('YYYY-MM DDD')      // 'combines DDD with MM but not DD, …'
```

When a pattern comes from configuration or a user, check it first rather
than catching:

```ts
import { formatPatternError, isValidFormatPattern } from 'astrotime'

isValidFormatPattern(fromConfig) // false
formatPatternError(fromConfig)   // 'unknown token(s) "hh", "ms"' — show this to the operator
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

Future leap seconds are unknowable: past the table's `expires` stamp,
conversions **fail open by default** (last known ΔAT — the right trade-off
for plotting and display, where future timestamps are routine). Pass
`{ tableValidity: 'reject' }` when uncertain UTC must not be presented as
certain — every conversion path then errors past the expiry.

Custom tables must contain the complete known leap-second history (the
bundled entries, verbatim) before any appended future entries — a partial
snapshot is rejected everywhere, because it would silently misapply old
ΔAT values to modern epochs. If a negative leap second is ever announced,
Unix labels inside the deleted second fold forward by default; pass
`{ leapGap: 'reject' }` to error on them instead.

### Time scales, J2000, Julian dates, GPS

```ts
import {
  instantToJ2000Seconds, instantFromJ2000Seconds, instantToJulianDate, instantToJulianDateParts,
  instantToModifiedJulianDate, instantFromJulianDate, instantToGpsWeek, instantFromGpsWeek,
  instantToCivil, J2000_INSTANT, GPS_EPOCH_INSTANT,
} from 'astrotime'

instantToJ2000Seconds(i, 'tdb')       // 840414965.97… — SPICE ET convention (approximate TDB: < 30 µs vs CSPICE, 1972–2100)
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
import { compareInstants, duration, instantRange, parseInstantOrThrow, truncateInstant, formatIso } from 'astrotime'

const start = parseInstantOrThrow('2026-08-19T00:00:00Z')
const end = parseInstantOrThrow('2026-08-19T00:30:00Z')
const ticks = [...instantRange(start, end, duration({ minutes: 10 }))] // 00:00, 00:10, 00:20
const ordered = [end, start].sort(compareInstants)                    // → [start, end]

const i = parseInstantOrThrow('2026-08-19T12:34:56.789Z')
formatIso(truncateInstant(i, 'day', 'utc'))  // '2026-08-19T00:00:00.000Z' (scale-aware: TAI days differ by ΔAT)
formatIso(truncateInstant(i, 'hour', 'gps')) // '2026-08-19T11:59:42.000Z' (a GPS hour boundary)
```

Also available: `isBefore` / `isAfter`, `minInstant` / `maxInstant`, `clampInstant`, `instantsEqual`.

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

### Working with numeric APIs (plots, charts, existing code)

Plot scales, chart libraries and most existing code accept a `number`, not a
`bigint`. The precision you get from a double depends on its **magnitude**,
not on the library that produced it — and absolute Unix milliseconds are a
large magnitude:

| Carried as | Value today | Finest representable difference |
|---|---|---|
| Unix milliseconds since 1970 | ~1.8 × 10¹² | **~244 ns** |
| Offset in ms from the start of the day | ~4.5 × 10⁷ | **~7 ps** |
| Offset in ms from the start of the hour | ~2.1 × 10⁶ | **~0.2 ps** |

So keep the exact `Instant`, and hand the numeric layer an *offset from a
nearby origin* — typically the start of your view window:

```ts
import { instantFromOffsetMillis, instantToOffsetMillis, truncateInstant, unixMillisResolutionNanos } from 'astrotime'

const origin = truncateInstant(i, 'day', 'utc')   // any nearby instant works
const x = instantToOffsetMillis(i, origin)        // 45296789.012345 — feed this to the plot
const back = instantFromOffsetMillis(x, origin)   // exactly i, to the nanosecond

unixMillisResolutionNanos(i)                      // 244.1 — what you'd have lost
```

`instantToOffsetSeconds` / `instantFromOffsetSeconds` are the same in seconds.
Because the round trip is exact, sub-microsecond timestamps survive a journey
through a plain-`number` API that would otherwise quantise them.

### Serialization

`Instant` and `Duration` are frozen objects with `toJSON`. An instant
serializes as its **TAI** reading (`"2026-08-19T12:35:33.789012345 TAI"`),
never as UTC: the TAI string is independent of any leap-second table, so a
value constructed with a custom or future table still round-trips losslessly
through `parseInstant`. Durations serialize as ISO 8601 (`"PT1H30M"`). Format
explicitly with `formatIso(i)` when you want a UTC string for display. For
binary protocols use `instantToTaiNanos(i)` / `instantFromTaiNanos(n)` (a `bigint`).

## Interop

- **Time zones / locales**: `new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', … }).format(instantToDate(i))`.
- **Temporal**: `Temporal.Instant.fromEpochNanoseconds(instantToUnixNanos(i))` and back via `instantFromUnixNanos`.
- **satellite.js / TLE**: feed `instantToDate(i)` to `propagate`; use `instantToGpsWeek` / `instantToJ2000Seconds` for epochs.
- **Open MCT**: a `TimeSystem` formatter needs only `formatInstant` / `parseInstant` — see `examples/openmct-utc-time-format.js`.

## Precision & limits

- `Instant` and `Duration` arithmetic is exact to 1 ns at any magnitude (`bigint`). Civil/ISO conversions cover years −999 999 … +999 999 and **throw `RangeError`** beyond, rather than emitting strings that cannot round-trip; `instantToDate` throws outside the ECMAScript `Date` range; decomposing/formatting a duration throws past 2^53 days.
- Functions returning a float `number` carry double resolution (~0.1 µs for J2000 seconds today; ~50 µs for a single-float Julian date — use the two-part form).
- `instantNow()` has millisecond precision (it reads `Date.now()`); nanosecond precision applies to stored and parsed timestamps.
- UTC before 1972 is approximated with TAI − UTC = 10 s (the real pre-1972 "rubber second" UTC is out of scope); opt into rejection with `before1972: 'reject'`.
- ISO duration parsing deviates from ISO 8601 deliberately: comma or dot fractions and a leading sign are accepted; weeks are exclusive (`P1W2D` rejected); only the last component may carry a fraction; components are capped at 16 digits.
- UT1 / ΔT, SCLK and SPICE kernels are out of scope.

## Intended use

astrotime is built and verified for ground tooling: displays, dashboards,
plotting, log analysis, mission-planning UIs. It is **not** certified for
flight, navigation, command, or safety-critical paths — those carry
process requirements (NPR 7150.2 class assessment, IV&V) that no library
can satisfy on its own. Correctness evidence: astropy/ERFA and NAIF CSPICE
golden vectors, property-based round-trips, and an adversarial suite, all in
CI on Node and Bun.

## Development

```sh
bun install
bun run test            # vitest: astropy golden + drift vectors, fast-check properties
bun run bench           # vitest benchmarks
bun run check:release   # format, lint, knip, typecheck, coverage, dist suite, traceability, conformance
bun run evidence        # regenerate the release evidence bundle
bun run test:mutation   # Stryker mutation testing
./scripts/conformance-hermes.sh   # digest under the React Native engine
pip install astropy==6.0.1 spiceypy==6.0.0   # regenerate reference fixtures (see CONTRIBUTING.md)
```

## API reference

Everything is a flat, tree-shakeable named export. `R<T>` below means `Result<T, InvalidTimeError | TimeParseError>`.

| Group | Exports |
|---|---|
| Construct | `instantFromUnixMillis/Seconds/Nanos` · `instantFromDate` · `instantNow` · `instantFromTaiNanos` · `instantFromUtc(fields) → R` · `instantFromCivil(fields, scale) → R` |
| Read | `instantToUnixMillis/Seconds/Nanos` · `instantToDate` · `instantToTaiNanos` · `instantToUtc` · `instantToCivil(i, scale)` |
| Parse / format | `parseInstant → R` · `parseInstantOrThrow` · `isValidInstant` · `formatIso` · `formatOrdinal` · `formatInstant(i, pattern)` · `INSTANT_TOKEN` · `isValidFormatPattern` · `formatPatternError` · `parsePatternError` |
| Scales | `instantToScaleNanos/Seconds` · `instantFromScaleNanos/Seconds` · `instantToJ2000Seconds/Nanos` · `instantFromJ2000Seconds/Nanos` · `instantToJulianDate[Parts]` · `instantFromJulianDate[Parts]` · `instantToModifiedJulianDate` · `instantFromModifiedJulianDate` · `instantToGpsWeek/Seconds` · `instantFromGpsWeek/Seconds` |
| Durations | `duration({…})` · `durationFromDays/Hours/Minutes/Seconds/Millis/Nanos` · `durationToDays/…/Nanos` · `durationToComponents` · `parseDuration → R` · `parseDurationOrThrow` · `formatDuration(d, 'iso' \| 'clock' \| pattern)` · `addDurations` · `subtractDurations` · `negateDuration` · `absDuration` · `scaleDuration` · `durationPatternError` · `compareDurations` · `durationsEqual` · `isNegativeDuration` · `ZERO_DURATION` |
| Numeric interop | `instantToOffsetMillis/Seconds` · `instantFromOffsetMillis/Seconds` · `unixMillisResolutionNanos` |
| Arithmetic & order | `addDuration` · `subtractDuration` · `durationBetween` · `compareInstants` · `instantsEqual` · `isBefore` · `isAfter` · `minInstant` · `maxInstant` · `clampInstant` · `instantRange` · `truncateInstant(i, unit, scale)` |
| Leap seconds | `deltaAt` · `deltaAtUnixSeconds` · `isLeapSecond` · `isUtcDefined` · `IERS_LEAP_SECONDS` · `parseLeapSecondsList → R` · `validateLeapSecondTable → R` · `freezeLeapSecondTable` · `isLeapSecondTableExpired` · `PRE_1972_DELTA_AT` |
| Calendar | `isLeapYear` · `daysInMonth` · `daysInYear` · `dayOfYear` · `daysFromCivil` · `civilFromDays` · `civilFromOrdinal` |
| Constants | `J2000_INSTANT` · `GPS_EPOCH_INSTANT` · `UNIX_EPOCH_INSTANT` · `UTC_START_INSTANT` · `TT_MINUS_TAI_NANOS` · `GPS_MINUS_TAI_NANOS` · `JD_UNIX_EPOCH` · `JD_J2000` · `MJD_OFFSET` · `NANOS_PER_*` · `TIME_SCALES` · `TIME_SCALE_LABELS` |
| Results & errors | `unwrap` · `unwrapOr` · `ok` · `err` · `isAstrotimeError` · `TimeParseError` · `InvalidTimeError` · `LeapSecondTableError` · `isInstant` · `isDuration` |

Every export has JSDoc — hover in your editor for the details, read [`DESIGN.md`](DESIGN.md) for the model and its invariants, [`API-STABILITY.md`](API-STABILITY.md) for the compatibility promise, and [`ASSURANCE-ROADMAP.md`](ASSURANCE-ROADMAP.md) with [`REQUIREMENTS.md`](REQUIREMENTS.md) for the evidence trail.

## License

MIT
