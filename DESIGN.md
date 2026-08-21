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
  `1970-01-01T00:00:00 TAI`. Frozen, branded; construct only via functions; `toJSON`/`toString` give the canonical TAI string (leap-table independent).
  TAI is uniform, so arithmetic is exact and leap seconds never corrupt it.
- `Duration` — signed `bigint` nanoseconds of elapsed (SI) time. Days are
  exactly 86 400 s; there are no calendar durations (months/years rejected).
- `LeapSecondTable` — sorted `{ unixSeconds, deltaAt }` entries plus `expires` and `updated`.
  A bundled IERS/IANA table ships with the package; every UTC conversion
  accepts an optional `{ leapSeconds }` override so apps can hydrate a fresher
  table from `leap-seconds.list` (IANA/NIST) or `Leap_Second.dat` (IERS) via
  `parseLeapSecondsList`. No global mutable state.
- Scales: `utc | tai | tt | gps | tdb`. TT = TAI + 32.184 s; GPS = TAI − 19 s;
  TDB = TT + three leading Fairhead & Bretagnon terms (USNO Circular 179 eq. 2.6; < 30 µs vs ERFA, documented).
  UT1 is out of scope (needs IERS EOP data).
- Leap-second semantics: UTC `23:59:60` is representable and valid only when the
  table has a positive leap at that boundary. `instantToUnixMillis` follows POSIX:
  the leap second repeats the following second's Unix value. Pre-1972 UTC is
  approximated with ΔAT = 10 and documented as such.
- Calendar math is proleptic Gregorian, integer-only (Hinnant's algorithms).
  Public calendar helpers reject impossible dates, invalid ordinals and
  unsafe-integer domains rather than normalizing them.
- Julian dates are offered both as a single `number` (≈50 µs precision near
  the present, documented) and as two-part `{ jd1, jd2 }` for full precision.
  UTC Julian dates use the SOFA quasi-JD convention (86 401-second leap days),
  so they are monotonic and match astropy on leap days; POSIX repeat semantics
  apply only to the Unix-time functions.

## API shape (flat named functions)

```
instantFromUnixMillis/Seconds/Nanos ↔ instantToUnix* / instantFromDate / instantToDate / instantNow
instantFromTaiNanos / instantToTaiNanos / isInstant
instantFromUtc(fields, opts) → Result<Instant, InvalidTimeError>
instantToUtc(i, opts) → CivilDateTime { year, month, day, dayOfYear, hour, minute, second(0–60), nanosecond }
instantFromCivil(fields, scale) / instantToCivil(i, scale)       // any scale's own calendar
addDuration / subtractDuration / durationBetween / compareInstants / instantsEqual / isBefore / isAfter
minInstant / maxInstant / clampInstant / instantRange / truncateInstant(i, unit, scale)
duration({days,hours,minutes,seconds,millis,micros,nanos}) / durationFrom*/durationTo* / durationToComponents
parseDuration / parseDurationOrThrow / formatDuration(d, 'iso' | 'clock' | pattern) / scaleDuration (exact)
parseInstant(text, { format: 'iso' | 'ordinal' | tokenPattern, scale, leapSeconds }) → Result / parseInstantOrThrow
formatInstant(i, pattern, { scale }) / formatIso / formatOrdinal   // non-UTC output carries ' TAI' etc.
instantToJ2000Seconds/Nanos ↔ instantFromJ2000* / instantToJulianDate[Parts] ↔ instantFromJulianDate[Parts]
instantToModifiedJulianDate / instantToScaleNanos ↔ instantFromScaleNanos / instantToScaleSeconds
instantToGpsWeek/Seconds ↔ instantFromGps* / deltaAt / deltaAtUnixSeconds / isLeapSecond / isUtcDefined
IERS_LEAP_SECONDS / parseLeapSecondsList / validateLeapSecondTable / isLeapSecondTableExpired
J2000_INSTANT / GPS_EPOCH_INSTANT / UNIX_EPOCH_INSTANT / UTC_START_INSTANT
```

Tokens (strict, small): `YYYY MM DD DDD HH mm ss S…S(1–9) Z [literal]`; `Z` is the
scale designator (`Z` for UTC, ` TAI` etc. otherwise) in both directions.
Expected failures (parsing, invalid fields) return `Result`; bugs throw `RangeError`.

## Non-goals

Time zones and locale formatting (use `Intl` with `instantToDate`), UT1/ΔT,
calendar (month/year) arithmetic, SPICE kernels/SCLK.
