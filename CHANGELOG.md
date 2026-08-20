# Changelog

## 0.2.0 - 2026-08-20

Breaking changes driven by an external correctness review.

- **SPICE-correct J2000 origins**: `instantToJ2000Seconds/Nanos` (and their inverses) now measure from 2000-01-01T12:00:00 *as read on the requested scale*, so `'tdb'` matches NAIF SPICE ET exactly (previously all scales shared the TT-noon instant, biasing ET by ~93 µs).
- **Table-independent serialization**: `Instant#toJSON`/`toString` emit the TAI reading (`… TAI`) instead of a UTC string, so serialized values are lossless under any leap-second table.
- Leap-second tables are validated deeply (safe integers, midnight alignment, non-empty, metadata types) and frozen: `parseLeapSecondsList` and `validateLeapSecondTable` return deeply frozen tables, `freezeLeapSecondTable` is exported, and unfrozen custom tables are re-validated per call so post-hoc mutation cannot poison caches.
- New `tableValidity: 'reject'` option errors on conversions past the table's expiry instead of silently assuming no further leap seconds (default remains `'allow-stale'`, documented).
- Formatting and `toJSON` throw `RangeError` outside the supported ±999 999-year civil range instead of emitting non-round-trippable strings; negative expanded years now format as sign+6 digits and parse back; token patterns accept expanded years; `instantToDate` throws outside the `Date` range instead of returning an Invalid Date.
- ISO duration parsing tightened: exclusive weeks, fraction only on the last component, 15-digit component cap; leap-second lists capped at 10 000 lines; `durationToComponents`/`formatDuration` throw past 2^53 days instead of silently losing precision.
- Verification: NAIF CSPICE golden vectors (ET epochs + pairwise elapsed-TAI at double precision), nanosecond-precision TDB comparison (previously ms-truncated), full-range property generators, and an adversarial suite (mutable/stale/malformed tables, negative leaps across every API, pathological input).
- Release pipeline: privilege-split publish job, SBOM attached to GitHub releases, CODEOWNERS, packed-package smoke on Node and Bun.

## 0.1.0 - 2026-08-20

Initial release.

- `Instant` (TAI nanoseconds) and `Duration` (signed nanoseconds): frozen, branded, JSON-serializable values with exact arithmetic.
- Leap-second-aware UTC with a bundled IERS table (valid to 2027-06-28), `parseLeapSecondsList` for the IANA/NIST and IERS formats, table validation, `before1972: 'reject'`, negative-leap handling.
- Scales: UTC, TAI, TT, GPS, TDB (Fairhead & Bretagnon three-term series, exact round-trip); seconds since J2000, Julian / Modified Julian dates (SOFA quasi-JD for UTC), GPS week.
- ISO 8601 calendar/ordinal parsing with validated offsets, scale designators (`… TAI`) and 1–9 fraction digits; strict token patterns; ISO and clock durations; ordering, ranges and scale-aware truncation helpers.
- Correctness locked to astropy 6.0.1: golden vectors, ±1 ns leap-boundary drift vectors, and fast-check round-trip properties.
