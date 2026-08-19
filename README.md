# astrotime

Zero-dependency spacecraft & astronomy time for TypeScript.

- **Exact instants** — `bigint` nanoseconds on the TAI timeline; arithmetic never drifts, never skips, never double-counts a leap second.
- **Leap-second-aware UTC** — `23:59:60` is a real, validated time; the IERS table ships in the box and can be replaced at runtime from `leap-seconds.list` / `Leap_Second.dat`.
- **Time scales** — UTC, TAI, TT, GPS, TDB; seconds since J2000 (SPICE-style ET), Julian / Modified Julian dates (single and two-part), GPS week/seconds-of-week.
- **Strict parse & format** — ISO 8601 calendar and ordinal (day-of-year / "SCET") forms with 1–9 fraction digits and UTC offsets; small token patterns (`YYYY-DDDTHH:mm:ss.SSSSSS`); ISO 8601 and clock durations.
- **Correct by reference** — conversions are tested against [astropy](https://www.astropy.org/) (ERFA/SOFA) golden vectors, including every inserted leap second since 1972.
- **Small** — ~12 KB gzipped for everything, tree-shakeable, no runtime dependencies, works in browsers, Node ≥ 22, Bun, Deno and React Native (Hermes).

```ts
import { parseInstant, formatIso, formatOrdinal, durationBetween, durationToSeconds, unwrap } from 'astrotime'

const leap = unwrap(parseInstant('2016-12-31T23:59:60.5Z'))
formatIso(leap, { scale: 'tai' }) // '2017-01-01T00:00:36.500'
formatOrdinal(leap)               // '2016-366T23:59:60.500'

const next = unwrap(parseInstant('2017-01-01T00:00:00.5Z'))
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

## Concepts

| Type | What it is |
|---|---|
| `Instant` | A point in time: nanoseconds since `1970-01-01T00:00:00 TAI`. Opaque; build via functions. |
| `Duration` | Signed nanoseconds of elapsed SI time. Days are exactly 86 400 s. No months/years. |
| `UtcDateTime` | Broken-down UTC (`year, month, day, dayOfYear, hour, minute, second (0–60), nanosecond`). |
| `LeapSecondTable` | `{ entries: [{ unixSeconds, deltaAt }], expires }` — TAI−UTC history. |
| `TimeScale` | `'utc' \| 'tai' \| 'tt' \| 'gps' \| 'tdb'` |

Expected failures (parsing, invalid fields) return a `Result<T, E>` (`{ ok: true, value } | { ok: false, error }`);
`unwrap(result)` throws the typed error for you when that is what you want.

## Usage

### Parse and format

```ts
import { parseInstant, formatInstant, formatIso, formatOrdinal, isValidInstant, unwrap } from 'astrotime'

// ISO 8601 calendar or ordinal, optional time, 1–9 fraction digits, Z or ±HH:mm
parseInstant('2026-08-19T12:34:56.789012345Z')
parseInstant('2026-231T12:34:56.789')        // day-of-year ("SCET"-style)
parseInstant('2026-08-19T13:34:56+01:00')
parseInstant('2026-08-19')                   // midnight UTC

// Only the ordinal form
parseInstant('2026-231', { format: 'ordinal' })

// Strict token patterns (YYYY MM DD DDD HH mm ss S…S Z [literal])
parseInstant('2026-08-19 12:34:56.789', { format: 'YYYY-MM-DD HH:mm:ss.SSS' })
isValidInstant('2026-08-19 12:34', { format: 'YYYY-MM-DD HH:mm' }) // true

// Other scales: the text is read on that scale's clock
parseInstant('2017-01-01T00:00:37', { scale: 'tai' }) // == 2017-01-01T00:00:00Z

const i = unwrap(parseInstant('2026-08-19T12:34:56.789012Z'))
formatIso(i)                                     // '2026-08-19T12:34:56.789Z'
formatIso(i, { precision: 'auto' })              // '2026-08-19T12:34:56.789012Z'
formatIso(i, { precision: 'nanos', scale: 'tt' })// '2026-08-19T12:36:05.973012000'
formatOrdinal(i)                                 // '2026-231T12:34:56.789'
formatInstant(i, 'YYYY-DDD[T]HH:mm:ss.SSSSSS')   // '2026-231T12:34:56.789012'
formatInstant(i, 'YYYY-MM-DD HH:mm')             // '2026-08-19 12:34'
```

### Unix time, `Date`, now

```ts
import { instantFromUnixMillis, instantToUnixMillis, instantFromDate, instantToDate, instantNow } from 'astrotime'

const i = instantFromUnixMillis(Date.now())
instantToUnixMillis(i)             // POSIX ms (sub-ms kept as a fraction)
instantToDate(i)                   // nearest Date
instantFromDate(new Date())
instantNow()                       // from Date.now(); pass { now } to inject a clock
```

POSIX Unix time cannot represent a leap second, so `instantToUnixMillis` repeats the
following second's values during `23:59:60` (exactly what every Unix kernel does).
The reverse direction is never ambiguous.

### UTC fields and leap seconds

```ts
import { utcToInstant, instantToUtc, deltaAt, unwrap } from 'astrotime'

const ok = utcToInstant({ year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60 }) // ok: true
utcToInstant({ year: 2016, month: 12, day: 30, hour: 23, minute: 59, second: 60 })
// { ok: false, error: InvalidTimeError('second', 60, 'no leap second is inserted at this time') }

utcToInstant({ year: 2024, dayOfYear: 366, hour: 6 }) // ordinal input

instantToUtc(unwrap(ok))
// { year: 2016, month: 12, day: 31, dayOfYear: 366, hour: 23, minute: 59, second: 60, nanosecond: 0 }

deltaAt(unwrap(ok)) // 36  (TAI − UTC in effect; 37 from 2017-01-01)
```

Negative leap seconds (a deleted `23:59:59`) are handled too, should the IERS ever announce one.

### Time scales, J2000, Julian dates, GPS

```ts
import {
  secondsSinceJ2000, instantFromSecondsSinceJ2000, julianDate, julianDateParts,
  modifiedJulianDate, instantFromJulianDate, gpsWeek, instantFromGpsWeek, instantToCivil, J2000_INSTANT,
} from 'astrotime'

secondsSinceJ2000(i, 'tdb')         // SPICE "ET" seconds past J2000
secondsSinceJ2000(i, 'tt')          // TT seconds past J2000
instantFromSecondsSinceJ2000(8.4e8, 'tdb')

julianDate(i, 'utc')                // 2461271.02…  (≈50 µs float resolution)
julianDateParts(i, 'tt')            // { jd1: 2461270.5, jd2: 0.525… } (full precision)
modifiedJulianDate(i, 'tai')
instantFromJulianDate(2451545.0, 'tt') // J2000

gpsWeek(i)                          // { week: 2432, secondsOfWeek: 304514.789012 }
instantFromGpsWeek(2432, 304514.789012)

instantToCivil(i, 'tai')            // broken-down TAI clock reading
formatIso(J2000_INSTANT)            // '2000-01-01T11:58:55.816Z'
```

Definitions: TT = TAI + 32.184 s; GPS = TAI − 19 s; TDB = TT + the three leading
periodic terms of the Fairhead & Bretagnon series (USNO Circular 179 eq. 2.6, < 20 µs error).

### Durations

```ts
import { duration, parseDuration, formatDuration, durationComponents, addDuration, unwrap } from 'astrotime'

const d = duration({ days: 1, hours: 2, minutes: 3, seconds: 4.5 })
formatDuration(d)                    // 'P1DT2H3M4.5S'
formatDuration(d, 'HH:mm:ss')        // '26:03:04'   (largest unit present absorbs the rest)
formatDuration(d, 'D[d] HH:mm:ss.SSS')// '1d 02:03:04.500'

parseDuration('PT90M')               // ISO 8601
parseDuration('1T02:03:04.005')      // day-of-year style
parseDuration('36:00:00')            // clock, hours unbounded
durationComponents(d)                // { sign: 1, days: 1, hours: 2, minutes: 3, seconds: 4, nanos: 500000000 }

addDuration(i, d)
```

### Keeping the leap-second table fresh

The bundled table is current as of its `expires` date (IERS Bulletin C). Check it, and hydrate a newer one from the canonical files if you need to:

```ts
import { IERS_LEAP_SECONDS, isLeapSecondTableExpired, parseLeapSecondsList, formatIso, unwrap } from 'astrotime'

if (isLeapSecondTableExpired(IERS_LEAP_SECONDS, Date.now() / 1000)) {
  const text = await (await fetch('https://data.iana.org/time-zones/data/leap-seconds.list')).text()
  const leapSeconds = unwrap(parseLeapSecondsList(text)) // also accepts IERS Leap_Second.dat
  formatIso(someInstant, { leapSeconds })
}
```

Every UTC-dependent function takes an optional `{ leapSeconds }`; there is no global mutable state.

## Interop

- **Time zones / locales**: `new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', … }).format(instantToDate(i))`.
- **Temporal**: `Temporal.Instant.fromEpochNanoseconds(instantToUnixNanos(i))` and back via `instantFromUnixNanos`.
- **satellite.js / TLE**: feed `instantToDate(i)` to `propagate`; use `gpsWeek` / `secondsSinceJ2000` for epochs.
- **Open MCT**: a `TimeSystem` formatter needs only `formatInstant(instantFromUnixMillis(v), pattern)` / `parseInstant(text, { format })` — see `examples/openmct-utc-time-format.js`.

## Precision & limits

- `Instant` and `Duration` are exact to 1 ns over ±292 000 years (bigint).
- Functions returning a `number` of seconds/ms carry float resolution (~0.1 µs for J2000 seconds today; ~50 µs for a single-float Julian date — use the two-part form).
- UTC before 1972 is approximated with TAI − UTC = 10 s (the real pre-1972 "rubber second" UTC is out of scope).
- UT1 / ΔT, SCLK and SPICE kernels are out of scope.

## Development

```sh
bun install
bun run test            # vitest, incl. astropy golden vectors
bun run check:release   # format, lint, knip, typecheck, coverage, packed-package smoke test
python3 scripts/generate-golden.py > tests/fixtures/astropy-golden.json   # regenerate reference data (needs astropy)
```

## License

MIT
