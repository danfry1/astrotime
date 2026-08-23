# NASA software-assurance crosswalk

This is a readiness crosswalk, not a declaration of NASA compliance. NASA
requirements are tailored after an adopting project determines software class
and safety criticality. The authoritative current sources are
[NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayDir.cfm?c=7150&s=2D&t=NPR)
and
[NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398);
reviewers must recheck their revision status before use.

| NASA area | Repository evidence | Readiness status | Authority still required |
|---|---|---|---|
| NPR 7150.2D §3.1 — life-cycle planning and acceptance criteria | `ASSURANCE-ROADMAP.md`; `ASSURANCE-CASE.md`; release acceptance gates | Partial | Adopting project plan, schedule, resources and approved acceptance criteria |
| §3.5 — software classification | Scope and exclusions in `ASSURANCE-CASE.md` | Adopter responsibility | Project classification record and independent classification assessment |
| §3.6 — software assurance and IV&V | Evidence bundle, verification workflows and independent-review entry criteria | Partial | Approved Software Assurance Plan and independent organization |
| §3.7 — safety-critical software | Hazard log; structural coverage; complexity ≤15 gate | Technically prepared, not classified | Safety-critical determination, hazard analysis, 100% MC/DC for identified components, Technical Authority waivers if any |
| §3.9 — development processes and practices | `CONTRIBUTING.md`; required release gate; exact-pinned tools | Implemented at repository level | Project tailoring and process approval |
| §3.11 — cybersecurity | `SECURITY.md`; CodeQL; Scorecard; zero runtime dependencies; pinned actions | Implemented at repository level | System threat assessment and authorization boundary |
| §3.12 — bidirectional traceability | `REQUIREMENTS.md`; `HAZARD-LOG.md`; `TRACEABILITY.md`; checked paths and test titles | Implemented for repository scope | Trace into system requirements, system hazards and operational procedures |
| §4.1 — software requirements | Numbered, testable requirements and strict domain/tolerance claims | Implemented for public claims | Stakeholder validation and mission allocations |
| §4.2–4.4 — architecture, design and implementation | `DESIGN.md`; immutable TAI model; bounded modules; complexity gate; type and lint checks | Implemented for repository scope | Integrated-system design reviews |
| §4.5 — software testing | Unit, property, adversarial, golden, differential, built-package, timezone and cross-engine suites | Implemented for ground-use scope | Independent test design, target-platform and system acceptance testing |
| §4.6 — operations, maintenance and retirement | Leap freshness monitoring; supported-version and vulnerability policies | Partial | Named operational owner, deployment/rollback, retention and retirement plans |
| §5.1 — configuration management | Git history, signed releases/tags, immutable package version, lockfiles and provenance | Implemented at repository level | Adopter baseline and change-control records |
| §5.2 — risk management | `HAZARD-LOG.md`; explicit residual and operational controls | Partial | System likelihood/severity assignment and accepted residual risk |
| §5.3 — peer reviews/inspections | Pull-request controls and CODEOWNERS | Partial | Recorded independent formal inspection with entrance/exit criteria |
| §5.4 — software measurements | Test/requirement/coverage/mutation/complexity/differential metrics in evidence | Implemented at repository level | Project-specific thresholds and trend review |
| §5.5 — non-conformance and defect management | `NONCONFORMANCE.md`; release-blocking policy | Implemented at repository level | Project defect system linkage and independent closure authority |
| NASA-STD-8739.8B — assurance, safety and IV&V | Assurance case, hazard controls, traceability, raw evidence and limitations | Prepared for assessment | Independent assurance organization, approved tasking and signed assessment |

## Safety-critical gate

NASA's current SWE-219 guidance requires 100 percent Modified
Condition/Decision Coverage for identified safety-critical components, and
NPR 7150.2D establishes a cyclomatic-complexity ceiling of 15 for those
components. The repository applies the complexity ceiling to all production
functions. Ordinary V8 branch coverage is not represented as MC/DC; an adopter
classifying any component as safety-critical must run and independently review
an MC/DC-capable structural analysis on the exact qualified implementation.

## Closure condition

“NASA standard software” is a valid outcome only when a specific adopting
project completes the right-hand column, closes or accepts all findings, and
its authorized engineering and Safety and Mission Assurance organizations sign
the tailored compliance and assurance records.
