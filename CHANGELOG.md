# Changelog

## 0.5.0 - 2026-08-20

Fourth review round: appended-entry coverage and file integrity.

- **Breaking**: appended custom-table entries must lie at or after the
  bundled table's coverage boundary (its IERS Bulletin C expiry). "After the
  known 2017 entry" was not "future": a fabricated 2018 leap second passed
  0.4.0 validation and shifted 2020 conversions by one second; it is now
  rejected, with regression tests for before-boundary (reject), at-boundary
  (accept), and multiple future positive/negative leaps (accept).
- `parseLeapSecondsList` now verifies the IANA `#h` integrity record when
  present (SHA-1 over the file's stamp and entry digits, algorithm confirmed
  against the live IANA file), using a built-in FIPS-vector-tested SHA-1;
  malformed or mismatching records are rejected.
- Committed direct regression tests for impossible IERS dates
  ("31 February" expiry, "31 June" row) that previously relied on ad-hoc
  verification.
- Correction: the 0.4.0 changelog said release tags are signed; v0.4.0 was
  annotated but unsigned. Tags are signed from v0.5.0.

## 0.4.0 - 2026-08-20

Third review round: the leap-table history guarantee.

- **Breaking**: custom leap-second tables must contain the complete known
  history — every bundled entry, verbatim, in order — before any appended
  future entries. The previous first-entry check admitted partial snapshots
  that silently misapplied old ΔAT values (e.g. a one-row table producing a
  26-second error for 2016 epochs); all such shapes are now rejected on every
  entry point, and the test suite no longer endorses partial tables anywhere.
- IERS `Leap_Second.dat` calendar columns and `File expires on` dates are
  validated as real dates (rejecting JavaScript's silent normalization of
  e.g. "31 June" to 1 July) and round-tripped against the MJD column.
- Documentation drift: duration component cap corrected to 16 digits, the
  full-history and `leapGap` policies documented in the README's UTC
  guidance, gzip size claim updated to ~20 KB. Release tags are annotated
  and signed from this version onward.

## 0.3.0 - 2026-08-20

Second external-review round: make invalid temporal states unrepresentable and every accuracy claim mechanically honest.

- **Breaking — table coverage**: leap-second tables must start with the canonical 1972-01-01 entry (`unixSeconds 63072000, deltaAt 10`); partial tables that would silently misapply the pre-1972 fallback are rejected everywhere, and `deltaAtUnixSeconds` now validates its table like every other entry point.
- **Honest ET claim**: `instantToJ2000Seconds(i, 'tdb')` is documented as the SPICE ET *convention* with an *approximate* TDB model (< 30 µs vs CSPICE/ERFA over 1972–2100, CI-enforced) — "exactly" removed; TT J2000 remains exact.
- **Explicit gap semantics**: new `leapGap: 'fold' | 'reject'` option for Unix labels deleted by a negative leap second (default folds onto the following midnight); `instantFromScaleNanos('utc')` documents POSIX non-injectivity instead of claiming to be an inverse.
- Duration serialization closed over its range: ISO/clock formatting uses bigint (no float rounding of absorbed units), parser accepts up to 16-digit components, so `P9007199254740991D` round-trips.
- `tableValidity: 'reject'` honours non-midnight expiry stamps on civil construction; `parseLeapSecondsList` validates metadata stamps as safe integers, cross-checks IERS MJD against the redundant calendar columns, and returns only fully validated tables.
- Docs/pipeline drift fixed: SECURITY supported versions, DESIGN serialization note, precise token-permission wording; the tag pipeline now runs the full `check:release` gate (coverage + knip included).

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
