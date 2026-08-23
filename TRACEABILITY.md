# Bidirectional assurance traceability

This matrix extends `REQUIREMENTS.md` beyond requirement-to-test references.
The release gate verifies that every hazard and every requirement appears here
and that every referenced implementation/evidence path exists. Rows group
closely related requirements; the underlying requirement-to-test mapping
remains one row per requirement in `REQUIREMENTS.md`.

| Hazard | Requirements | Design and implementation | Verification evidence | Residual/operational control |
|---|---|---|---|---|
| HAZ-UTC-001 | `REQ-CORE-001`, `REQ-UTC-001`, `REQ-UTC-002`, `REQ-UTC-003`, `REQ-UTC-004`, `REQ-UTC-005`, `REQ-JD-001`, `REQ-JD-002` | `DESIGN.md`; `src/instant.ts`; `src/leap-seconds.ts`; `src/scales.ts` | `tests/instant.test.ts`; `tests/leap-seconds.test.ts`; `tests/adversarial.test.ts`; `tests/golden.test.ts` | Integrated interfaces must preserve leap labels and POSIX fold/gap policy. |
| HAZ-DATA-001 | `REQ-UTC-007`, `REQ-UTC-008`, `REQ-TBL-001`, `REQ-TBL-002`, `REQ-TBL-003`, `REQ-TBL-004`, `REQ-TBL-005`, `REQ-TBL-006`, `REQ-TBL-007`, `REQ-TBL-008` | `src/leap-seconds.ts`; `src/instant.ts`; `scripts/check-leap-seconds.ts` | `tests/leap-seconds.test.ts`; `tests/adversarial.test.ts`; `.github/workflows/leap-seconds.yml` | Adopter owns authenticated updates and expiry response. |
| HAZ-EPOCH-001 | `REQ-CORE-004`, `REQ-UTC-006`, `REQ-FMT-001` | `src/calendar.ts`; `src/instant.ts`; `src/format.ts` | `tests/calendar.test.ts`; `tests/adversarial.test.ts`; `tests/parse-format.test.ts` | Reject pre-1972 approximation when prohibited by the system error budget. |
| HAZ-SCALE-001 | `REQ-SCALE-001`, `REQ-SCALE-002`, `REQ-SCALE-003`, `REQ-SCALE-004`, `REQ-SCALE-005`, `REQ-SCALE-006`, `REQ-SCALE-007` | `DESIGN.md`; `src/scales.ts` | `tests/scales.test.ts`; `tests/golden.test.ts`; `tests/drift.test.ts`; `tests/spice.test.ts`; `scripts/differential.py` | Use ephemeris-grade conversion when analytical TDB tolerance is insufficient. |
| HAZ-NUM-001 | `REQ-NUM-001`, `REQ-NUM-002`, `REQ-DUR-002`, `REQ-FMT-002` | `src/numeric.ts`; `src/duration.ts`; `src/scales.ts`; `src/instant.ts` | `tests/duration.test.ts`; `tests/scales.test.ts`; `tests/adversarial.test.ts`; `tests/properties.test.ts` | Preserve bigint/two-part values through external storage and transport. |
| HAZ-INPUT-001 | `REQ-DUR-001`, `REQ-PARSE-001`, `REQ-PARSE-002`, `REQ-PARSE-003`, `REQ-PARSE-004`, `REQ-FMT-003`, `REQ-FMT-004`, `REQ-FMT-005`, `REQ-FMT-006`, `REQ-FMT-007`, `REQ-API-001` | `src/options.ts`; `src/parse.ts`; `src/pattern.ts`; `src/format.ts`; `src/duration.ts` | `tests/api.test.ts`; `tests/parse-format.test.ts`; `tests/duration.test.ts`; `tests/adversarial.test.ts` | Integration must surface deliberate errors rather than substituting defaults. |
| HAZ-PORT-001 | `REQ-DET-001` | `src/numeric.ts`; `src/sha1.ts`; `scripts/conformance.mjs`; `scripts/conformance-hermes.sh` | `.github/workflows/ci.yml`; `.github/workflows/differential.yml`; `tests/sha1.test.ts` | Qualify each exact production engine/compiler combination. |
| HAZ-API-001 | `REQ-CORE-002`, `REQ-CORE-003`, `REQ-API-002` | `API-STABILITY.md`; `src/index.ts`; `src/result.ts`; `src/types.ts` | `tests/api.test.ts`; `tests/result.test.ts`; `tests/instant.test.ts`; `scripts/check-package.ts` | Pin and regression-test upgrades in the adopting system. |
| HAZ-SUPPLY-001 | `REQ-TBL-005`, `REQ-API-002` | `SECURITY.md`; `package.json`; `bun.lock`; `.github/workflows/release.yml` | `.github/workflows/codeql.yml`; `.github/workflows/scorecard.yml`; `scripts/evidence.mjs` | Verify release signatures, provenance, SBOM and accepted artifact hash. |
| HAZ-ASSURE-001 | `REQ-CORE-001`, `REQ-SCALE-002`, `REQ-SCALE-004`, `REQ-SCALE-007`, `REQ-DET-001` | `ASSURANCE-CASE.md`; `ASSURANCE-ROADMAP.md`; `NONCONFORMANCE.md`; `scripts/check-traceability.mjs`; `scripts/check-complexity.mjs` | `vitest.config.ts`; `stryker.config.json`; `scripts/evidence.mjs`; `.github/workflows/release.yml` | Final review and acceptance evidence must be produced independently. |

## Non-conformance link

When a verification fails or a requirement is not met, the release is blocked
and a record is controlled under `NONCONFORMANCE.md`. The record identifies the
affected hazard and requirement IDs, which makes the relationship from a
defect back to this matrix machine-searchable and reviewable.
