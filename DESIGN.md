# astrotime — design

Zero-dependency, tree-shakeable TypeScript library for spacecraft / astronomy
time: exact instants with nanosecond precision, leap-second-aware UTC, TAI / TT /
GPS / TDB scales, Julian dates, and strict parse/format for ISO-8601, ordinal
(day-of-year, "SCET") and duration strings.

## Why

- Open MCT wants to drop `moment` / `moment-timezone` (#7393, #7872) and is
  blocked on microsecond timestamps by moment's millisecond model (#2538).
- JPL AMMOS hand-rolled ~1300 lines of DOY / ISO / duration utilities
  (`@nasa-jpl/plandev-time-utils`) on top of lodash and postgres-interval.
- CesiumJS hardcodes its leap-second table inside `JulianDate.js` (#4092).
- No npm package covers UTC↔TAI↔TT↔GPS with a replaceable leap-second table in
  a small, typed, dependency-free form.

## Model

- `Instant` — a point on the TAI timeline, stored as `bigint` nanoseconds since
  `1970-01-01T00:00:00 TAI`. Opaque/branded; construct only via functions.
  TAI is uniform, so arithmetic is exact and leap seconds never corrupt it.
- `Duration` — signed `bigint` nanoseconds of elapsed (SI) time. Days are
  exactly 86 400 s; there are no calendar durations (months/years rejected).
- `LeapSecondTable` — sorted `{ unixSeconds, deltaAt }` entries plus `expires`.
  A bundled IERS/IANA table ships with the package; every UTC conversion
  accepts an optional `{ leapSeconds }` override so apps can hydrate a fresher
  table from `leap-seconds.list` (IANA/NIST) or `Leap_Second.dat` (IERS) via
  `parseLeapSecondsList`. No global mutable state.
- Scales: `utc | tai | tt | gps | tdb`. TT = TAI + 32.184 s; GPS = TAI − 19 s;
  TDB = TT + 0.001657 sin g + 0.000014 sin 2g (≈30 µs accuracy, documented).
  UT1 is out of scope (needs IERS EOP data).
- Leap-second semantics: UTC `23:59:60` is representable and valid only when the
  table has a positive leap at that boundary. `toUnixMillis` follows POSIX:
  the leap second repeats the following second's Unix value. Pre-1972 UTC is
  approximated with ΔAT = 10 and documented as such.
- Calendar math is proleptic Gregorian, integer-only (Hinnant's algorithms).
- Julian dates are offered both as a single `number` (≈50 µs precision near
  the present, documented) and as two-part `{ jd1, jd2 }` for full precision.

## API shape (flat functions, no classes)

```
instantFromUnixMillis / instantToUnixMillis / instantFromDate / instantToDate / instantNow
instantFromTaiNanos / taiNanosOf
utcToInstant(fields, opts) → Result<Instant, InvalidTimeError>
instantToUtc(i, opts) → UtcDateTime { year, month, day, dayOfYear, hour, minute, second(0–60), nanosecond }
civilToInstant(fields, scale) / instantToCivil(i, scale)         // tai|tt|gps uniform calendars
addDuration / subtractDuration / durationBetween / compareInstants / instantsEqual
duration({days,hours,minutes,seconds,millis,micros,nanos}) / durationFromSeconds / durationToSeconds / durationComponents
parseDuration(text) / formatDuration(d, pattern)
parseInstant(text, { format: 'iso' | 'ordinal' | tokenPattern, scale, leapSeconds }) → Result
formatInstant(i, pattern, { scale, leapSeconds }) / formatIso / formatOrdinal
secondsSinceJ2000 / fromSecondsSinceJ2000 / julianDate / julianDateParts / fromJulianDate / modifiedJulianDate
gpsWeek / fromGpsWeek / deltaAt
IERS_LEAP_SECONDS / parseLeapSecondsList / isLeapSecondTableExpired
```

Tokens (strict, small): `YYYY MM DD DDD HH mm ss S…S(1–9) Z [literal]`.
Expected failures (parsing, invalid fields) return `Result`; bugs throw.

## Non-goals

Time zones and locale formatting (use `Intl` with `instantToDate`), UT1/ΔT,
calendar (month/year) arithmetic, SPICE kernels/SCLK.
