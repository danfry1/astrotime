# Assurance case

## Status and claim boundary

This document is a repository-level assurance argument, not a NASA approval or
a substitute for an adopting project's classification, hazard analysis,
tailoring, independent verification and validation (IV&V), or Technical
Authority acceptance.

The supported assurance claim is:

> Within the documented API domains, time ranges, data-validity policies and
> numerical tolerances, astrotime provides deterministic and traceable
> civil-time and astronomical-time conversion suitable for independently
> assessed ground-based planning, analysis, display and decision-support use.

Ordinary JavaScript runtimes are outside the claimed scope for in-the-loop
flight control, crew/vehicle safety functions, hard real-time control, or any
use requiring a demonstrated worst-case execution time. For those contexts,
astrotime can serve as an executable specification and differential oracle for
a separately qualified implementation.

## Top-level argument

| Claim | Argument | Principal evidence |
|---|---|---|
| C1 — elapsed time is exact | Instants and durations use immutable `bigint` nanoseconds on the uniform TAI timeline; arithmetic never occurs on UTC labels. | `DESIGN.md`; `REQ-CORE-*`; property, instant and adversarial suites |
| C2 — UTC discontinuities are controlled | Positive and negative leap seconds, POSIX folds/gaps, table expiry and pre-1972 approximation are explicit policies with boundary tests. | `REQ-UTC-*`; `REQ-TBL-*`; `tests/leap-seconds.test.ts`; `tests/adversarial.test.ts` |
| C3 — scale accuracy is bounded | Exact scale offsets are separated from the approximate physical TDB model; claims state independently measured tolerances. | `REQ-SCALE-*`; ERFA/SOFA and CSPICE fixtures; 100,000-case differential sweep |
| C4 — invalid states fail deliberately | Runtime shapes, unsafe integers, impossible calendar values, corrupted tables and out-of-domain values are rejected rather than normalized. | `REQ-CORE-004`; `REQ-NUM-*`; `REQ-PARSE-*`; `REQ-API-*` |
| C5 — supported engines agree | The numerical core avoids engine-dependent trigonometry and is checked by digest across independent JavaScript engines. | `REQ-DET-001`; V8/JSC/Hermes conformance jobs |
| C6 — releases are attributable and reproducible | Runtime dependencies are zero; inputs are pinned; signed source, provenance, SBOM, hashes and raw verification reports bind evidence to a release. | `SECURITY.md`; release workflow; `scripts/evidence.mjs` |
| C7 — assurance does not silently regress | Requirements, hazard mappings, complexity, coverage, package behavior, differential accuracy and mutation evidence are machine checked. | `REQUIREMENTS.md`; `TRACEABILITY.md`; `HAZARD-LOG.md`; release gate |

## Assumptions imposed on adopters

1. The adopter pins and verifies an exact release artifact and its provenance.
2. The adopter selects a documented UTC data-validity policy rather than
   assuming future UTC is known.
3. The leap-second table is monitored, reviewed and updated before expiry.
4. The adopter does not interpret pre-1972 UTC as exact, and supplies
   `observer` wherever TDB must be a topocentric (observer-on-Earth) reading.
5. The supported runtime and platform are tested in the integrated system.
6. The system hazard analysis determines whether timestamps can command,
   inhibit or otherwise contribute to a hazardous action.
7. Independent acceptance testing uses requirements and reference sources, not
   implementation-derived expected values.

## Explicit limitations

- UTC before 1972 defaults to a documented fixed 10-second approximation and
  can be rejected.
- UTC after the bundled table's expiry is unknown; permissive use is explicit
  and can be rejected.
- TDB uses the full Fairhead & Bretagnon series, geocentric unless an
  Earth-fixed `observer` is given (then with ERFA's topocentric terms). Its
  integer-lattice inverse has at most 1 ns numerical round-trip error. Model
  fidelity is separately bounded to 1e-13 s against ERFA `dtdb` (1600–2500)
  and 1 ns against astropy readings; physical accuracy is ERFA's stated ±3 ns
  against DE405 over 1950–2050; omitting `observer` omits the topocentric
  term (up to ~2.1 µs).
  CSPICE's one-term model differs from it by up to 40 microseconds.
- Single-number Julian dates have ordinary IEEE-754 resolution limits. The
  two-part API exists for nanosecond preservation.
- UT1, the Earth Rotation Angle and mean sidereal time are only as good as
  the IERS data supplied: they are refused outside its span and across gaps,
  flagged when predictions contribute, and omit sub-daily ocean-tide and
  libration terms (tens of microseconds of UT1). Nutation, apparent sidereal
  time, spacecraft clocks, ephemerides and time zones are outside scope.
- No defect-free or mission-independent safety claim is made.

## Acceptance gates

A release is an assurance candidate only when all of the following hold:

1. The release commit and tag are signed and the worktree used for evidence is
   clean.
2. Every documented requirement resolves to verification evidence and every
   requirement participates in the hazard traceability matrix.
3. All production functions have normal McCabe complexity at or below 15.
4. The complete source and built-package suites pass with enforced coverage.
5. Leap-second validation/parsing retains 100 percent reachable structural
   coverage; unreachable branches are removed or justified.
6. Cross-engine conformance digests are identical.
7. ERFA/SOFA and CSPICE accuracy limits pass; the large differential sweep has
   zero mismatches.
8. Mutation results are generated from the exact verification inputs and every
   high-consequence survivor is reproduced or dispositioned.
9. The packed artifact, SBOM and raw evidence archive have hashes and build
   provenance.
10. No open release-blocking non-conformance remains.

Final use acceptance remains the responsibility of the adopting project's
software engineering, Safety and Mission Assurance, IV&V and Technical
Authority organizations.
