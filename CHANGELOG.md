# Changelog

## Unreleased

An API-surface audit, done now because the library has no adopters and the
cost of changing a public name rises to permanent the moment it has one.

- **Fix**: an options argument that is not an options object is rejected.
  `formatInstant(i, pattern, 'tai')` was accepted in silence and the default
  scale used, so it rendered a UTC reading 37 seconds from the TAI one the
  caller asked for. `scale` is positional on the seventeen scale converters
  and lives in the options bag for format and parse, which makes the mistake
  a near miss rather than an obvious one; the error names the fix.
- **Fix**: the same guard now covers every options-bearing entry point,
  including uniform-scale conversions that otherwise never inspect UTC
  options. Arrays, bigint/symbol/function arguments, and `null` members for
  `scale`, `format`, `precision`, `designator` or `leapSeconds` fail with a
  deliberate `RangeError` rather than selecting a default or leaking a
  native `TypeError`. Structured duration inputs and range options receive
  the same runtime-shape checks for JavaScript callers.
- **Fix/security**: an IANA `#h` record can no longer appear to authenticate
  IERS rows, which are absent from the IANA digest input. Hash records now
  require the IANA `#$`, `#@` and data-row shape; mixed IANA/IERS rows and
  non-decimal metadata spellings are rejected.
- Leap-table validation now handles missing arrays and non-object entries as
  structured `LeapSecondTableError` / `RangeError` failures instead of
  leaking property-access `TypeError`s to JavaScript callers.
- **Fix**: `unixMillisResolutionNanos` reports the finer of the adjacent
  double spacings. At an exact power of two the old one-sided calculation
  returned twice the finest representable difference.
- **Hardening**: `isLeapYear`, `daysInYear` and `daysInMonth` reject
  non-safe-integer inputs, and `daysInMonth` rejects months outside 1–12,
  instead of returning a plausible calendar answer for invalid input.
- **Accuracy**: TDB now evaluates all seven terms of the Fairhead &
  Bretagnon truncation published in USNO Circular 179 rather than only its
  three largest terms. Independent Astropy/ERFA differential testing over
  100,000 seeded epochs from 1972–2100 found a 9.282 µs maximum error, so
  the ERFA acceptance limit is tightened from 30 µs to 10 µs. CSPICE uses a
  distinct truncated periodic model; its independently tested 30 µs bound
  remains explicit rather than being conflated with the ERFA bound.
- **Fix/documentation**: the TDB inverse now corrects against the actual
  integer-nanosecond forward map at expanded years and chooses the closest
  representable TT reading. The former claim of a universally exact TDB
  integer round-trip was mathematically impossible where the continuously
  varying offset crosses a nanosecond rounding boundary; the executable
  contract is now the honest ≤ 1 ns bound across years −999 999…+999 999.
- **Breaking**: `addDuration` and `subtractDuration` are renamed to
  `addToInstant` and `subtractFromInstant`. They differed from
  `addDurations` and `subtractDurations` by a single letter while taking
  different argument types and returning different types. TypeScript
  rejects a mix-up; JavaScript callers get no warning.
- **Breaking**: `ok` and `err` are no longer exported. They construct
  `Result`s, which is internal; consumers read them with `.ok`, `unwrap`
  and `unwrapOr`. Exporting the constructors made "build your own
  astrotime-shaped Result" a compatibility obligation.
- **Breaking**: `INSTANT_TOKEN` is no longer exported. A `RegExp` has mutable
  internal state even when frozen (`RegExp.compile()` can change its source
  before failing on a frozen property), so exporting the exact regex used by
  parsing exposed a global format-semantics mutation point. The supported
  pattern contract remains documented and is queryable through
  `formatPatternError` / `parsePatternError`.

- `Result`'s error type is now constrained to `Error`. Every `Result` the
  library produces already carried one, and `ok`/`err` are no longer
  exported, so `unwrap` no longer needs a branch for wrapping a non-`Error`
  value — the branch was unreachable through the public API and is gone.
- Tests: `unwrapOr` had no coverage at all and `unwrap` was only ever called
  on its success path; both are now exercised on both sides, including that
  `unwrap` rethrows the carried error by identity rather than a wrapper.
  Error `cause` serialization is covered for the `Error` and non-`Error`
  cases. SHA-1 gains message lengths at every padding boundary — where
  `len % 64` reaches 56 an extra block is required, which is where a
  hand-written implementation usually breaks — checked against digests from
  `node:crypto`.
- Documented: why `instantToModifiedJulianDate` subtracts the offset from the
  high part of the two-part Julian date rather than from the collapsed value
  (about 10x better round-trip accuracy), now enforced by a test that fails
  if it is "simplified"; why TypeScript is pinned below the current major;
  and which coverage ceilings are unreachable rather than unmet.
- The complete runtime export list is now an executable contract exercised
  against both source and the built package, so documentation and manifest
  changes cannot silently diverge again. Corrected the README's `Date`
  conversion wording: sub-millisecond values are truncated toward negative
  infinity, not rounded to the nearest millisecond.
- **Assurance architecture**: adds a repository assurance case, hazard log,
  NASA NPR 7150.2D / NASA-STD-8739.8B readiness crosswalk,
  non-conformance policy and machine-checked bidirectional traceability from
  all 10 hazards through all 47 requirements to implementation and
  verification evidence. These are preparation for an adopter's independent
  assessment, not a claim of NASA certification.
- **Complexity gate**: every production function is now held to a normal
  McCabe complexity ceiling of 15; the current maximum is 14 across 220
  functions. The leap-list parser and duration formatter were decomposed to
  meet the gate without changing their public behavior.
- **High-consequence coverage**: leap-table parsing and validation now have
  100% reachable structural coverage, including the exact 10,000-line limit,
  safe-integer TAI-boundary overflow, both mixed-format directions, duplicate
  metadata, calendar boundaries and independent corruption of both known-row
  fields. Global coverage floors rise to 98% statements, 95% branches, 100%
  functions and 98.5% lines.
- **Mutation strength**: the full Stryker 10 campaign now covers 3,308 mutants
  at 85.46% overall. Leap-second code rises from 76.52% to 91.16%, with all
  588 mutants covered; surviving mutants and the static-runner limitation
  remain documented rather than excluded from the score.
- **Release evidence**: coverage, complexity, differential and exact-input
  mutation reports are archived raw with per-file SHA-256 hashes. A release
  cannot publish without current 100,000-epoch differential and mutation
  results; the complete evidence archive receives a GitHub/Sigstore build
  attestation and ships beside the SBOM.
- **Supply chain**: the verification toolchain is now fetched by content rather
  than by name. The astropy/ERFA differential sweep installs from a hash-pinned
  `scripts/requirements-differential.txt` under `pip install --require-hashes`,
  which also freezes `astropy-iers-data` so a re-run cannot draw a different
  reference leap-second table. The Hermes CLI download is checked against a
  recorded SHA-256 before it decides anything about cross-engine conformance,
  and the Babel class transform that conformance depends on now resolves from
  lockfile-pinned devDependencies instead of an unpinned install at run time.
- **Fix**: the `#h` integrity test tampered with a string absent from its own
  fixture — the file body carries NTP seconds, not Unix seconds — so the
  substitution was inert and only the `#$` stamp was ever proven tamper-evident.
  Every hashed component is now covered: the `#$` stamp, the `#@` expiry and
  each data row. A replacement that matches nothing fails the test rather than
  passing in silence.

Two other candidates were examined and left alone. The `instantBrand` and
`durationBrand` symbols appear in the emitted types but are in no export
list, so no consumer can reach them; they are required for nominal typing.
`isLeapYear` is already exported alongside the calendar functions rather
than the leap-second ones.

## 0.12.0 - 2026-08-21

- **Fix**: reject every expanded spelling of ISO negative-zero years
  (`-0000`, `-00000`, `-000000`) in both ISO and token-pattern parsing.
  The longer spellings previously normalized silently to year `0000`.
- **Fix**: ISO leap seconds with non-zero UTC offsets are resolved at their
  shifted UTC boundary rather than being rejected wholesale. Offset shifts at
  the extreme supported years now return an `InvalidTimeError` result instead
  of allowing an internal civil-range exception to escape.
- **Fix**: UTC two-part Julian-date inversion no longer rounds a fraction at
  the final nanosecond of a leap day across midnight before normalization.
  On a positive leap day that lost the identity of `23:59:60.999999999` and
  returned `23:59:59.999999999`, exactly one second early; the corresponding
  negative-leap edge could fold forward incorrectly. Integer and fractional
  JD parts are now normalized separately.
- **Breaking hardening**: public calendar helpers now reject impossible dates,
  invalid ordinals and unsafe-integer domains instead of normalizing them;
  `clampInstant` rejects inverted bounds; GPS week inputs enforce a safe week
  number and seconds-of-week in `[0, 604800)`.
- Runtime safety: misspelled UTC policies, time scales, format options and
  truncation units now throw `RangeError`; extreme instants throw outside the
  supported civil/GPS-number domains instead of returning corrupt numeric
  fields; exported time-scale metadata is frozen.
- Leap-table validation rejects update/expiry metadata that contradicts the
  table interval; its text parser rejects duplicate metadata and trailing row
  garbage; numeric leap-table APIs reject non-finite epochs. Non-finite values
  in structured validation errors serialize as strings instead of JSON `null`.
- Assurance tooling now uses stable TypeScript 5.9.3 (the experimental
  TypeScript 7 package removed the compiler API required by Stryker), and
  current Stryker 10.0.0. Mutation reports carry a digest of all verification
  inputs so stale results cannot be included in release evidence.
- Verification: two-part Julian-date round trips are asserted exactly at
  nanosecond precision for UTC/TAI/TT/GPS (and to TDB's unavoidable 1 ns
  integer-lattice bound) across the civil range and every known leap boundary; calendar
  conversion is exhaustively checked across three 400-year Gregorian eras;
  the 100,000-case astropy differential sweep now also covers TDB and UTC/TT
  two-part Julian dates. The final Stryker 10 run covers 3,335 mutants at an
  82.82% score, with its static-runner limitation reproduced and documented.
- Documentation: correct the serialized `Instant` scale (TAI, not UTC), current
  bundle/benchmark figures, supported security version, and the evidence
  roadmap's implemented/planned split.

## 0.11.2 - 2026-08-21

- Docs: corrects a claim about NASA Open MCT. Earlier text said its
  notification timestamps had a bug "of exactly that shape" as this
  library's stray-letter case. The root cause is shared — a mistyped
  pattern accepted in silence — but the output is not: Open MCT stamps
  notifications with `'YYYY-MM-DD hh:mm:ss.ms'`, which Moment renders as
  `2026-08-19 12:34:56.3456`, repeating the minute and second rather than
  emitting a literal `.ms`. That is this library's *duration* failure mode,
  not its instant one. Restated accurately, with the 12-hour `hh` noted too.

## 0.11.1 - 2026-08-21

- **Fix**: stray letters separated by a `[literal]` were still reported as
  one run, so `'x[foo]y'` named an unknown token `"xy"` that appears nowhere
  in the pattern. 0.11.0 fixed this for letters separated by a *field* token
  and missed the bracket path. Diagnostics only — both patterns were, and
  are, correctly rejected.

## 0.11.0 - 2026-08-21

- **Fix**: a parse pattern combining `DDD` with only one of `MM`/`DD` silently
  discarded the field it was given and returned the date the ordinal named —
  `parseInstant('2026-12 231', { format: 'YYYY-MM DDD' })` read as 19 August,
  ignoring month 12. There is no complete calendar date to check the ordinal
  one against in that shape, so the pattern is now rejected. `YYYY-MM-DD DDD`
  is still cross-checked and `YYYY DDD` still stands on its own.
- New: `parsePatternError`, and parse errors now point at it rather than at
  `formatPatternError`. The two directions genuinely differ — `'HH:mm'`
  renders perfectly well and names no instant to read back — so one
  validator could not answer for both, and the old message recommended a
  check that returned `null` for a pattern parsing would reject.
- **Fix**: stray letters were merged across the valid tokens between them,
  so `'xYYYYy'` reported an unknown token `"xy"` that appears nowhere in it.
  They are now reported per run: `"x"`, `"y"`.
- A non-ASCII letter is documented as literal text rather than a suspected
  token: every token is ASCII, so `'YYYY年MM月DD日'` is a pattern with three
  literal labels. The cost, noted deliberately, is that a Latin-looking
  homoglyph such as a Greek `Μ` passes as literal.

## 0.10.0 - 2026-08-21

- **Breaking**: `formatInstant`, `formatDuration` and pattern-based
  `parseInstant` now throw `RangeError` for a pattern they cannot render or
  read faithfully, instead of quietly producing something else. This makes
  format patterns consistent with the rest of the library, which already
  throws rather than emit a year outside the round-trippable range. Four
  defects are rejected, each one previously silent:
  - a letter belonging to no token — `'HH:mm:ss.ms'` rendered `'12:34:56.ms'`
    — and `'YYYY-MM-DDTHH:mm:ss'` silently lost its `T`;
  - an unterminated `[`, which swallowed the bracket and turned the rest of
    the pattern into literal text — `'YYYY [MM'` rendered `'2026 MM'`;
  - a letter run longer than its longest token, which split into two fields:
    `'.SSSSSSSSSS'` rendered `'.7890000007'`, which reads back as
    `.700000000`;
  - the same field twice, which repeated a number rather than formatting the
    field the letter was mistaken for: `'HH:mm:ss.ms'` as a *duration*
    rendered `'12:34:56.3456'`, since `m` and `s` are both valid duration
    tokens. `DD` and `DDD` are exempt — they are different fields that share
    a letter, so a pattern may carry both, and `parseInstant` now checks that
    they agree.

  A `]` outside a bracket is still a literal: it renders exactly as written,
  so it hides nothing from the reader of the pattern.
- **Breaking**: a defective *parse* pattern now throws instead of returning a
  `Result`. Previously `parseInstant(text, { format: 'YYYY-MM-DD hh:mm:ss' })`
  reported that the **text** could not be parsed, sending the reader looking
  for a bug in their data. A pattern comes from the caller's source, so it
  follows the documented split: expected failures return `Result`, bugs
  throw. A pattern with no `YYYY` throws for the same reason, and now does so
  whether or not the text happens to match.
- New: `formatPatternError` and `durationPatternError` return the same
  explanation the throw would carry, or `null`, for a pattern that comes from
  configuration or a user; `isValidFormatPattern` is the boolean form.
- Validation is folded into the bounded pattern cache, so a valid pattern is
  checked once, formatting throughput is unchanged, and a caller supplying
  endless distinct patterns cannot grow memory.

## 0.8.0 - 2026-08-21

- New: `instantToOffsetMillis` / `instantFromOffsetMillis`,
  `instantToOffsetSeconds` / `instantFromOffsetSeconds`, and
  `unixMillisResolutionNanos`, plus a README section on working with numeric
  APIs. Double precision depends on magnitude, so absolute Unix milliseconds
  resolve to only ~244 ns today, while an offset from a nearby origin (the
  start of the view window, say) resolves to picoseconds and round-trips
  exactly. This lets sub-microsecond timestamps survive a journey through
  plot scales and other `number`-only APIs without changing their types.
- Tooling: `tsdown` 0.22.14 (0.22.4 declared a TypeScript peer range of
  `^5 || ^6`, which the TypeScript 7 upgrade violated — `bun install` tolerates
  peer mismatches, so only npm's stricter SBOM step caught it). Dependency
  pinning is now enforced by `syncpack lint` in CI and the release gate, so a
  range specifier fails the build rather than reaching a release.

## 0.7.0 - 2026-08-21

Assurance evidence, no behavior change to documented APIs.

- **Deterministic output across JavaScript engines.** The TDB series no longer
  calls `Math.sin`, which ECMAScript does not specify bit-exactly (V8 and JSC
  demonstrably differ). A built-in deterministic sine (IEEE-exact operations
  only, error < 1e-11 over the series' argument range, i.e. < 0.02 ns of TDB)
  makes every output bit-identical everywhere. A CI job compares digests of
  110 000 outputs under V8 and JSC and fails on any divergence.
- **Requirements traceability.** `REQUIREMENTS.md` maps 29 documented claims to
  the tests that verify them; `bun run check:traceability` (in CI and the
  release gate) fails if a referenced test disappears or a requirement has no
  verifying test.
- **Mutation testing** with a published score and survivor analysis
  (`ASSURANCE-ROADMAP.md`): 86.60% overall, `sha1` 95.96%, `parse` 93.18%.
- New `ASSURANCE-ROADMAP.md` states the certification position plainly: this
  library targets certifiable-grade *evidence* for ground tooling; safety
  classification attaches to adopting systems and their processes, and
  JavaScript's runtime model permanently excludes in-the-loop flight software.
- New `instantFromScaleSeconds` (from 0.6.0, unpublished): inverse of
  `instantToScaleSeconds`, with its float resolution (~240 ns at present
  epochs) documented and bounded by test rather than overclaimed.

## 0.6.0 - 2026-08-21

- New: `instantFromScaleSeconds` — inverse of `instantToScaleSeconds`, closing the one asymmetric pair in the export surface.
- New: `API-STABILITY.md` — the public surface is frozen-additive until 1.0; open questions (Result naming, bound-context constructor, sub-path exports) are recorded there for a 1.0 decision.

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
