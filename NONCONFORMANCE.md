# Non-conformance and defect control

Every observed mismatch between requirements, implementation, verification,
documentation, release process or evidence is a non-conformance. Records live
in the project issue tracker unless security sensitivity requires the private
process in `SECURITY.md`.

## Required record

Each record must contain:

- affected `HAZ-*` and `REQ-*` identifiers;
- affected versions, commits, artifacts, platforms and data versions;
- reproducible expected and observed behavior;
- origin (test, analysis, operator report, audit or dependency advisory);
- severity and release-blocking decision with rationale;
- containment, root cause, correction and regression evidence;
- reviewer, closure authority and closure date;
- any accepted residual risk, waiver and approving authority.

## States

`reported → triaged → contained → corrected → independently verified → closed`

Rejection as not reproducible, duplicate, expected behavior or equivalent
mutation also requires recorded evidence and review. A code author cannot be
the sole verifier of a high-consequence closure.

## Release policy

- A known defect that can produce an incorrect instant, time-scale reading,
  leap-table decision, silent fallback, artifact substitution or evidence
  misattribution blocks release.
- A failed required check blocks release; checks are not skipped to obtain a
  passing artifact.
- A waived unreachable coverage branch or equivalent mutation must have a
  technical rationale and no feasible input that changes public behavior.
- Corrections add a regression test tied to the affected requirement and
  hazard unless the finding concerns process-only evidence.
- Security findings follow coordinated disclosure and are not exposed in a
  public record before remediation.

The adopting project remains responsible for importing repository findings
into its system defect and risk-management processes.
