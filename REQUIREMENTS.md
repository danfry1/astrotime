# Requirements traceability

Every load-bearing claim in the documentation is a numbered requirement,
verified by the named tests. `scripts/check-traceability.mjs` (run in CI)
fails if any referenced test title disappears or any requirement has no
reference. Backticked fragments must appear verbatim in `vitest list` output.

| ID | Requirement | Verified by |
|---|---|---|
| REQ-CORE-001 | Instant arithmetic is exact on the TAI timeline across leap seconds. | `adds and subtracts exact durations across a leap second` |
| REQ-CORE-002 | Instants and durations are frozen, branded values. | `are frozen, branded and serialisable`, `values are frozen, branded and serialisable` |
| REQ-CORE-003 | Serialization is the TAI string: lossless under any leap table. | `JSON round-trips identically under bundled and custom tables`, `serializes instants inside inserted leap seconds losslessly` |
| REQ-UTC-001 | 23:59:60 is accepted iff the table inserts a leap second at that boundary. | `accepts 23:59:60 only at a real leap second` |
| REQ-UTC-002 | A second deleted by a negative leap second is rejected on construction. | `rejects a second deleted by a negative leap second` |
| REQ-UTC-003 | Unix conversions follow POSIX semantics (values repeat through an inserted second). | `follows POSIX inside a leap second (values repeat)` |
| REQ-UTC-004 | Unix labels deleted by a negative leap fold forward by default and can be rejected. | `deleted Unix label folds forward by default and can be rejected` |
| REQ-UTC-005 | Negative leap seconds behave correctly across Unix, JD, truncation and range APIs. | `Unix time skips the deleted second without repeating`, `UTC quasi-JD treats the shortened day as 86399 seconds and stays monotonic`, `truncation lands on real boundaries around the deleted second`, `instantRange steps straight across the gap` |
| REQ-UTC-006 | Pre-1972 conversion is approximate by default and rejectable. | `approximates by default and can be told to reject` |
| REQ-UTC-007 | Conversions past table expiry fail open by default and are rejectable on every path, at second precision. | `fails open by default (documented) and can be told to reject`, `enforces the policy on every conversion path`, `enforces non-midnight expiry stamps on civil construction` |
| REQ-TBL-001 | Custom tables must contain the complete known history verbatim. | `rejects a partial table that would silently misapply the pre-1972 fallback` |
| REQ-TBL-002 | Appended entries must not predate the known coverage boundary. | `rejects appended entries that contradict known history (fabricated 2018 leap)`, `accepts appended entries at or after the bundled coverage boundary` |
| REQ-TBL-003 | Tables are deeply frozen; mutating an unfrozen table cannot poison caches. | `validateLeapSecondTable returns a deeply frozen copy`, `mutating an unfrozen table after warming caches cannot poison results` |
| REQ-TBL-004 | Every public entry point validates its table. | `deltaAtUnixSeconds validates its table` |
| REQ-TBL-005 | The IANA #h integrity record is verified when present. | `verifies the IANA #h integrity record when present` |
| REQ-TBL-006 | Impossible calendar dates in leap files are rejected, not normalized. | `rejects impossible IERS dates instead of normalizing them` |
| REQ-SCALE-001 | J2000 origins are per-scale; tdb follows the SPICE ET convention. | `uses each scale's own noon as its origin (NAIF/SPICE convention for TDB)` |
| REQ-SCALE-002 | TDB agrees with CSPICE within 30 µs over the validated interval. | `matches SPICE ET within the TDB series tolerance` |
| REQ-SCALE-003 | Elapsed TAI matches NAIF leap-second arithmetic at double precision. | `matches SPICE elapsed TAI between every pair of epochs (pure leap-second arithmetic)` |
| REQ-SCALE-004 | UTC and TT/TAI/GPS readings match astropy (ERFA/SOFA) at nanosecond precision, including every leap boundary. | `matches UTC, TT, GPS and day-of-year readings on every row` |
| REQ-SCALE-005 | Scale conversions round-trip exactly, TDB included. | `scale nanos round-trip exactly for every scale (TDB included)`, `differs from TT by at most 1.7 ms and round-trips exactly` |
| REQ-JD-001 | UTC Julian dates use the SOFA quasi-JD convention and stay monotonic through leap seconds. | `UTC uses the SOFA quasi-JD convention on leap-second days (monotonic)` |
| REQ-DUR-001 | ISO duration grammar: exclusive weeks, last-component fractions, 16-digit caps. | `rejects "P1W2D"`, `rejects "P1.5DT1H"` |
| REQ-DUR-002 | Duration serialization is closed over its range; decomposition past 2^53 days throws. | `duration serialization is closed at Number.MAX_SAFE_INTEGER days`, `throws RangeError when the day count cannot be a safe integer` |
| REQ-PARSE-001 | UTC offsets are range-validated; scale designators parse and must agree with the requested scale. | `resolves scales from designators and the scale option` |
| REQ-PARSE-002 | Parsers return Results and never throw on arbitrary text. | `parseInstant / parseDuration / parseLeapSecondsList return Results for arbitrary text`, `survives pathological parser input without throwing` |
| REQ-FMT-001 | Formatting throws RangeError outside the supported civil range rather than emitting non-round-trippable strings. | `toJSON throws rather than emitting a year that cannot round-trip` |
| REQ-FMT-002 | ISO output at nanosecond precision parses back to the same instant on every scale, across the full civil range. | `ISO format at nanosecond precision parses back to the same instant (all scales)` |
| REQ-DET-001 | Outputs are bit-identical across JavaScript engines (deterministic sine; no engine-dependent math). | CI job `Cross-engine conformance (V8 vs JSC)`; `sha1 (FIPS 180 vectors)` |

The final row's cross-engine digest is enforced by the `conformance` job in
`.github/workflows/ci.yml`, which fails unless V8 and JSC produce identical
digests over 110 000 outputs.
