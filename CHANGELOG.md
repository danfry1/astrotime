# Changelog

## Unreleased

An API-surface audit, done now because the library has no adopters and the
cost of changing a public name rises to permanent the moment it has one.

- **New**: topocentric TDB and TCB. `UtcOptions.observer` (WGS84 longitude
  and latitude in radians, height in metres) adds ERFA `dtdb`'s topocentric
  terms — the observer's diurnal motion and offset from the geocentre, up to
  ~2.1 µs for a surface station — wherever TDB or TCB is read: `formatIso`,
  `instantToScaleNanos`, J2000 seconds, Julian dates and parsing. Without it,
  readings are unchanged (geocentric). Against astropy (`Time` with a
  location) at the three Deep Space Network complexes, the equator, the South
  Pole and Mauna Kea, 245 of 246 readings agree to the nanosecond and the last
  within 1 ns; TCB still round-trips exactly. Heights beyond ±100 km are
  refused, since the model is for Earth-fixed observers. The conformance
  digest adds a Goldstone TDB reading: 200 000 outputs, `3d74a0a06dc7e6c1`,
  identical on V8, JavaScriptCore, Hermes and SpiderMonkey.
- **New**: apparent sidereal time and nutation (IAU 2006/2000A).
  `greenwichApparentSiderealTime` adds the equation of the equinoxes to GMST;
  `nutation` (Δψ, Δε), `meanObliquity` and `equationOfTheEquinoxes` need only
  TT. The 678 luni-solar and 687 planetary IAU 2000A terms and the 33 + 1
  complementary terms are generated from SHA-256-pinned ERFA v2.0.1 sources and
  evaluated in ERFA's order with the deterministic sine and cosine.
  Nutation reproduces ERFA `nut06a` within 4.9e-16 rad and obliquity `obl06`
  exactly over 1800–2200; the equation of the equinoxes is within 3.1 µas of
  ERFA `ee06a`, and apparent sidereal time within 1.3e-12 rad of `gst06a` on
  the tested IERS dates. The tables carry `@__PURE__` annotations, so a
  consumer that never calls nutation does not bundle them — now checked by
  `check:package` (a `formatIso`-only bundle drops from ~31.4 KB to ~20.8 KB
  gzipped). The cross-engine digest moves to `astrotime-conformance-v3` and
  adds nutation and the equation of the equinoxes: 195 000 outputs,
  `7c169553779050b9`, identical on V8, JavaScriptCore, Hermes and
  SpiderMonkey.
- **New**: UT1, the Earth Rotation Angle and Greenwich Mean Sidereal Time.
  `parseIersFinals` reads IERS `finals2000A` Earth-orientation files
  (Bulletin B where present, else Bulletin A with its prediction flag);
  `earthOrientationAt` interpolates UT1 − UTC, UT1 − TAI and polar motion;
  `earthRotationAngle` (IAU 2000), `greenwichMeanSiderealTime` (IAU 2006) and
  `instantToUt1JulianDateParts` build on it. All return a `Result` with the new
  `EarthOrientationError`. UT1 − TAI is interpolated, so a leap second never
  corrupts it; four-point Lagrange is the default (linear errs by up to
  ~20 µs on UT1's fortnightly tide, 28.5 µs on one tested date), with
  `'linear'` for astropy parity. Instants outside the table or inside a gap
  are refused rather than extrapolated, and `predicted` reports Bulletin A
  predictions. The ERA formula is evaluated in exact rational arithmetic on
  UT1 in femtoseconds. Against a verbatim IERS excerpt, linear UT1 − UTC
  matches astropy within 8e-15 s and ERA/GMST match ERFA `era00`/`gmst06`
  within 4e-14 rad; Lagrange results match an independent implementation.
  No EOP data is bundled. UT1 leaves the non-goals; long-term ΔT, nutation
  and apparent sidereal time remain out of scope.
- **New**: `tcg` (Geocentric Coordinate Time) and `tcb` (Barycentric
  Coordinate Time) join `TimeScale`, with ` TCG` / ` TCB` designators in
  parse and format. Both follow their IAU definitions (2000 B1.9, 2006 B3)
  with the defining constants carried as integer ratios, so a reading is
  exact rational arithmetic rounded once. TCG equals the exactly evaluated
  definition on all 500 committed reference instants across the
  ±999 999-year range, and instant → TCG → instant is exact. Over a
  100 000-epoch astropy sweep both agree within 1 ns; astropy's
  double-precision Julian dates misround about 0.5% of TCG readings, and
  exact rational arithmetic sides with astrotime on every one of them. TCB is
  computed from TT plus the unrounded TDB offset, rounding once rather than
  twice, and its inverse corrects against that forward map, so
  instant → TCB → instant is exact as well (TT → TCB always runs faster than
  one-for-one). `API-STABILITY.md` now records that
  `TimeScale` may gain members in minor releases. The conformance digest
  covers the two new scales (its current value is in the nutation entry).
- **Accuracy**: TDB now evaluates the full 787-term Fairhead & Bretagnon
  (1990) series with ERFA's JPL-mass adjustments — the geocentric model ERFA
  `dtdb` and astropy use — instead of the seven-term USNO Circular 179
  truncation. Against ERFA the offset now agrees within 1.0e-14 s over
  1600–2500 (was 9.3 µs); a seeded 100 000-epoch astropy sweep finds a 1 ns
  maximum TDB difference, which is nanosecond rounding, and the 28 golden
  epochs match exactly. Acceptance limits tighten to 1e-13 s against `dtdb`
  and 1 ns against astropy. The coefficient table is generated from a
  SHA-256-pinned ERFA v2.0.1 `dtdb.c` by `scripts/generate-tdb-series.mjs`
  and is guarded by a content digest; the ERFA BSD 3-clause notice ships in
  `THIRD-PARTY-NOTICES.md`. Within ±10 000 years of J2000 the evaluation is
  ERFA's; beyond it the series' T^n factors are held at their ±10-millennium
  values. ERFA's unbounded T^4 block reaches ~1000 s at ±700 millennia, where
  the double day argument resolves only milliseconds, and the resulting
  microsecond staircase broke the 1 ns TDB inverse contract (a property test
  found it). 308 000 random instants across the ±999 999-year civil range now
  round-trip with zero error.
- **Accuracy contract**: CSPICE's one-term ET model differs from the full
  series by up to 36.53 µs over 1972–2100 (half-day grid, `naif0012.tls`), so
  the CSPICE bound is restated as 40 µs. It was 30 µs only because the
  seven-term truncation happened to sit closer to CSPICE's model. The series
  remains geocentric: the topocentric term for an observer on the Earth's
  surface (up to ~2 µs) is not applied, as in astropy without a location.
- **Behavior**: TDB readings change by up to 9.3 µs relative to 0.12.0, and
  the cross-engine conformance digest changes (its current value is in the
  TCG/TCB entry above). Two TDB lattice tests use new
  rounding-boundary instants, each confirmed against ERFA to sit exactly on a
  half-nanosecond offset. A TDB conversion now costs a few microseconds and the
  gzipped bundle grows from ~28 KB to ~44 KB.
- **Fix**: a UTC two-part Julian date within 0.5 ns of a positive leap
  second resolved to the instant one second after it. The fraction was split
  into whole seconds before rounding to nanoseconds, so a value such as
  23:59:59.9999999997 on 2016-12-31 rounded to a full second without carrying,
  skipped the `23:59:60` branch, and landed on `2017-01-01T00:00:00`. The
  carry now happens first. Round trips from `instantToJulianDateParts` were
  unaffected; external quasi-JDs (`instantFromModifiedJulianDate` included)
  were not.
- **Documentation**: the README offset-millisecond example now defines the
  instant it converts, so its stated output is reproducible.
- **Build**: development-only transitive dependencies with published
  advisories (`tinypool`, `undici`, `fast-uri`, `brace-expansion`,
  `source-map-js` and others) are updated; `oxfmt` moves to 0.72.0 and three
  `overrides` pin fixed releases that Bun's seven-day `minimumReleaseAge`
  gate otherwise declined to select. The published package has no runtime
  dependencies and was not affected.
- **Fix**: a validation failure found after a UTC offset is applied now names
  the UTC reading it was found at. `2016-12-31T23:59:60+01:00` was rejected
  with "a leap second can only occur at 23:59:60" — which the text literally
  says — because the check runs on 22:59:60 UTC; the reason now reads
  "2016-12-31T23:59:60+01:00 is 2016-12-31T22:59:60 UTC; a leap second can
  only occur at 23:59:60". The same applies to `before1972: 'reject'`
  (`1972-01-01T00:30:00+01:00` reported year 1971), the civil-range check
  (`+999999-12-31T23:59:59-01:00` reported year 1000000), table expiry and
  negative leap seconds. Error codes, `field` and `value` are unchanged.
- **Breaking**: a parse pattern may no longer read a field below one it
  omits. `parseInstant('2026 19', { format: 'YYYY DD' })` returned 19
  January, `'YYYY mm'` put the minutes in hour zero and `'YYYY-MM-DD HH ss'`
  put the seconds in minute zero — each a default the text never stated, the
  same defect for which `'YYYY-MM DDD'` was already rejected. A field now
  requires every larger unit (`DD` needs `MM` or `DDD`, `HH` a full date, `mm`
  `HH`, `ss` `mm`, a fraction `ss`), and `parsePatternError` explains the
  gap. Stopping early (`'YYYY-MM'`, `'YYYY-MM-DD HH'`) is reduced precision
  and still reads the start of the unit. Format patterns are deliberately
  unaffected: `'mm:ss'` renders exactly the fields it names and defaults
  nothing.
- **Breaking**: ISO text with `Z` or a UTC offset on a date without a time
  (`2026-08-19+01:00`, `2026-08-19Z`, `2026-231Z`) is rejected; ISO 8601
  attaches a zone designator to a time of day only, and `2026-08-19+01:00`
  was silently read as 23:00 UTC on the 18th. A scale label on a bare date
  (`2017-01-01 TAI`) is still accepted, since a TAI or TT date is meaningful
  and reads as midnight on that clock.
- **Breaking**: the ISO grammar now matches its documentation. A basic-format
  offset inside extended text (`…T00:59:60+0100`) is rejected; `±HH` and
  `±HH:mm` remain, as ISO 8601 allows both in extended format. A signed year
  needs the six digits of an expanded year (`+2026-08-19`, `+0000-01-01`,
  `+12345-…` are rejected; `+002026-…`, `-0044-…` and `2026-…` are not), so
  `-00000-01-01` is now a grammar error rather than a negative-zero one. The
  optional space before a scale label is kept: the `Z` pattern token writes
  `…:37TAI`, and an ISO-shaped pattern's output therefore still reads back.
- **Breaking**: `parseInstant` rejects text whose instant would have a UTC
  reading or a TAI serialization outside the ±999 999-year civil range.
  `-999999-01-01T00:00:00 TT` parsed, and then `formatIso` and `String()`
  threw, because its UTC reading is 42.184 s earlier in year −1 000 000. At
  the far end the last 37 s of UTC text and the last 19 s of GPS text fell in
  TAI year 1 000 000, so the parsed instant could not be serialized. These now return an
  `InvalidTimeError` for `year`, as an offset shifted past the range already
  did.
- **Breaking**: `parseDuration` rejects durations longer than
  `Number.MAX_SAFE_INTEGER` days. `P9999999999999999D` parsed, and then
  `String()`, `JSON.stringify` and `formatDuration` threw on the value; the
  parser now returns a `TimeParseError` instead. In clock form, hours after a
  day count are limited to 0–23: `1T36:00:00` was silently read as
  `P2DT12H`. Clock hours without a day count remain unbounded (`36:00:00`).
- **Fix**: `instantFromGpsWeek(10, 604799.9999999999)` threw although the
  value is inside the documented `[0, 604800)` range: it rounds to 604800 s at
  nanosecond resolution. The range is now checked on the value given, and
  such a value carries into the first instant of the next week. Values below
  zero, which previously passed when they rounded to `0`, now throw as
  documented.
- **Documentation**: the deterministic sine's error comments are corrected.
  They claimed "max error ~4e-15" and "< 1e-13" for the Taylor series to
  x^15 on [−π/2, π/2]; the truncation error is ≈ 6.07e-12 (the first omitted
  term, (π/2)^17/17!), and 6.02e-12 is measured against `Math.sin`. Scaled by
  the TDB series amplitude that is ~1e-14 s of TDB offset, so no published
  accuracy bound changes. The numerics are untouched and the cross-engine
  conformance digest is unchanged (`astrotime-conformance-v2 135000
  a85edc8d2639f9b4`).
- **Verification**: the conformance digest now also runs under
  SpiderMonkey, the Firefox engine, on every pull request and in the
  scheduled extended-verification workflow.
  `scripts/conformance-spidermonkey.sh` fetches Mozilla's official js shell
  from the Firefox 153.4.0esr release on archive.mozilla.org, checks it
  against a recorded SHA-256 taken from that release's `SHA256SUMS`, runs
  the unmodified `scripts/conformance.mjs` as an ES module against the built
  `dist/index.mjs`, and fails unless the digest equals Node's. SpiderMonkey
  produces the same digest as V8, JavaScriptCore and Hermes.

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
