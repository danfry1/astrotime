# Repository hazard log

Hazard severity and likelihood depend on the integrated system and therefore
cannot be assigned honestly by this standalone library. The potential
consequences below are prompts for the adopter's system hazard analysis, not
system-level classifications. A project that permits a timestamp to command or
inhibit a hazardous action must reassess every entry in its operational
context.

| ID | Hazardous software condition | Potential system consequence | Repository controls | Required adopter control | Residual risk |
|---|---|---|---|---|---|
| HAZ-UTC-001 | A UTC/TAI mapping is wrong at a positive or negative leap boundary. | An event is ordered, displayed or scheduled one second early/late. | Exact TAI core; positive/negative leap tests; SOFA quasi-JD; POSIX fold/gap policies. | Test mission epochs and interfaces across every applicable boundary. | A downstream system can reinterpret POSIX labels or discard the leap indicator. |
| HAZ-DATA-001 | Leap data is incomplete, corrupt, unauthenticated, contradictory or stale. | Future UTC is silently computed with an invalid offset. | Full-history validation; IANA `#h` verification; immutable tables; expiry/reject policy; monthly freshness check. | Own the update procedure, independent review, deployment and expiry response. | No software can predict an unannounced future leap second. |
| HAZ-EPOCH-001 | Pre-1972 or out-of-range time is treated as exact. | Historical analysis receives an undocumented offset or corrupt calendar value. | Rejectable pre-1972 approximation; finite/safe-domain checks; explicit civil range. | Reject approximate epochs when the mission error budget does not permit them. | Historical UTC needs authoritative rubber-second data outside this model. |
| HAZ-SCALE-001 | TDB approximation or scale origin is used outside its accuracy contract. | Scientific or navigation calculations inherit microsecond-scale error. | Per-scale origins; seven-term model; ERFA and CSPICE bounds; separate numerical/physical claims. | Derive the mission error budget and use full ephemeris tooling where required. | Analytical TDB is intentionally not an ephemeris-grade nanosecond model. |
| HAZ-NUM-001 | Floating-point precision loss is mistaken for nanosecond precision. | Closely spaced samples collapse or round to a different epoch. | Exact bigint APIs; two-part JD; reported Unix-millisecond resolution; overflow rejection. | Preserve exact APIs across storage, transport and database interfaces. | Third-party numeric interfaces may irreversibly discard precision. |
| HAZ-INPUT-001 | Malformed options, text, patterns or calendar fields silently select defaults. | The wrong scale, policy or instant is accepted without operator awareness. | Strict runtime-shape checks; `Result` parsing; impossible-date and pattern rejection. | Treat every error as data-quality telemetry; do not blanket-catch and default. | An integrating layer can suppress or replace deliberate errors. |
| HAZ-PORT-001 | Runtime engines produce different astronomical results. | Identical inputs disagree across ground systems or mobile displays. | Deterministic sine; V8/JSC/Hermes digest; supported-runtime declaration. | Qualify the exact target runtime and rerun the conformance corpus. | Untested runtimes or compiler transforms remain unqualified. |
| HAZ-API-001 | An accidental export or semantic change bypasses review. | Integrators depend on unstable behavior or silently change interpretation after upgrade. | Exact export contract; API stability policy; built-package suite; signed changelog. | Pin versions and perform system regression before upgrade. | Semver cannot detect an integrator's undocumented dependency. |
| HAZ-SUPPLY-001 | Source, dependency, workflow or release artifact is substituted. | Correct tests are associated with different executable code. | Zero runtime dependencies; exact pins; frozen install; signed tags; SBOM; OIDC provenance; artifact hashes. | Verify signatures/provenance and retain the accepted artifact/evidence baseline. | Compromise of trusted identities or build infrastructure requires external response. |
| HAZ-ASSURE-001 | Verification evidence is stale, incomplete or generated from a dirty tree. | Reviewers approve claims that do not apply to the released code. | Verification-input digests; clean-tree marker; raw reports; traceability and complexity gates. | Independently reproduce the package hash and a risk-selected verification subset. | Repository-generated evidence is not independent V&V. |

See `TRACEABILITY.md` for the checked mapping from each hazard to requirements,
implementation and verification evidence. Non-conformances are controlled by
`NONCONFORMANCE.md`.
