# Assurance roadmap

astrotime targets **certifiable-grade evidence** for its stated scope
(non-safety-critical ground tooling: displays, planning, analysis). Safety
certification attaches to adopting systems and their processes (NPR 7150.2
classification, NASA-STD-8739.8, IV&V), not to a library; this roadmap
tracks the evidence that makes an adopter's assessment cheap. JavaScript's
runtime model (JIT, GC, no WCET analysis) permanently excludes in-the-loop
flight software — the ceiling is safety-involved display/decision-support
contexts, and beyond that a role as a differential cross-check oracle for
qualified implementations.

## In place

| Evidence | Where |
|---|---|
| Reference-implementation golden vectors (astropy/ERFA, NAIF CSPICE) | `tests/golden.test.ts`, `tests/drift.test.ts`, `tests/spice.test.ts` |
| Property-based round-trip invariants over the documented range | `tests/properties.test.ts` |
| Adversarial suite (mutable/partial/fabricated tables, negative leaps, pathological input) | `tests/adversarial.test.ts` |
| Cross-engine bit-identity (deterministic sine; V8 vs JSC digest over 110k outputs) | `scripts/conformance.mjs`, CI `conformance` job |
| Requirements-to-tests traceability, enforced in CI | `REQUIREMENTS.md`, `scripts/check-traceability.mjs` |
| Mutation testing, with survivor analysis | `stryker.config.json`, scores below |
| Large-scale differential sweep vs astropy (100 000 random instants, monthly + on demand) | `scripts/differential.py`, `.github/workflows/differential.yml` |
| Suite runs against the built artifact, not only source | `vitest.dist.config.ts`, CI `Suite against the built artifact` |
| Suite runs under five exotic time zones (no local-time dependency) | CI `Suite under exotic time zones` |
| Supply chain: zero deps, SLSA provenance, SBOM, signed tags, staged 2FA publish | `SECURITY.md`, release workflow |
| Leap-data freshness monitor (monthly vs IANA) + `#h` integrity verification | `.github/workflows/leap-seconds.yml`, parser |
| Five external adversarial review rounds, all findings closed | CHANGELOG 0.2.0–0.6.0 |

## Planned (in order)

1. **Per-release evidence bundle** — signed archive per release: test and
   coverage reports, mutation score, conformance digest, vector provenance
   (astropy/CSPICE/kernel versions), reproducible-build hash versus the npm
   tarball.
2. **Additional engines in conformance CI** — SpiderMonkey and Hermes via
   engine-version-manager, extending the bit-identity claim beyond V8/JSC.
3. **Assurance case document** — structured scope/hazard/mitigation/evidence
   argument for the time-display context (e.g. "operator acts on a timestamp
   wrong by one second across a leap boundary").
4. **Independent V&V** — external audit against `REQUIREMENTS.md` by a party
   with no involvement in development. Only an adopting organization's
   software-assurance process can classify usage; this repository's job is
   minimizing the cost of that assessment.

## Mutation scores

Measured with Stryker (`bun run test:mutation`), mutating `src/**` except
`index.ts`/`types.ts` (re-export only) and `assert.ts` (`assertNever` is an
unreachable-by-design exhaustiveness guard; code that cannot execute cannot
be covered by a test).

| Release | Overall | Weakest module | Strongest |
|---|---|---|---|
| 0.7.0 | 86.60% (2148 mutants, Stryker 9.6.1) | `leap-seconds.ts` 75.11% | `sha1.ts` 95.96%, `parse.ts` 93.18%, `duration.ts` 92.92% |

**Why not higher, honestly.** The surviving mutants were categorized rather
than chased. Three classes dominate and are not worth killing:

- *Equivalent mutants* (unkillable by definition). Example: `d.nanos < 0n`
  mutated to `<= 0n` in `abs`-style guards — since `-0n === 0n` in BigInt,
  both branches return an identical value. No test can distinguish them.
- *Internal error-message string literals.* Asserting exact wording of
  internal invariant messages makes tests brittle without finding defects.
  Message text **is** asserted where it is part of the public contract
  (every `toJSON()` shape in the error tests).
- *Defensive guards for states upstream validation already excludes*
  (`?? fallback` after an exhaustive check).

Spot-checks confirmed the suite does kill semantically meaningful mutants:
injecting an off-by-one into the Gregorian era arithmetic in `calendar.ts`
(`36_524` → `36_525`) fails the suite immediately.

**Tracked work:** `leap-seconds.ts` at 75.11% is the lowest-scoring module
and also the highest-consequence one. Raising it — with tests that assert
behavior, not message text — is the next assurance task before 1.0.
