## Change and rationale

Describe the required behavior, affected public contract and why the change is
necessary.

## Assurance impact

- Affected requirements: `REQ-...`
- Affected hazards: `HAZ-...`
- Accuracy/domain change:
- Failure-mode change:
- Backward-compatibility decision:

## Verification evidence

List new or changed tests, reference sources, boundary cases and independent
reproduction where applicable.

## Review checklist

- [ ] Requirements, hazards, implementation and tests remain bidirectionally traced.
- [ ] Normal McCabe complexity remains at or below 15.
- [ ] Exact scale logic and approximate physical models remain clearly separated.
- [ ] Positive/negative leap, expiry, pre-1972 and unsafe-domain effects were considered.
- [ ] Source and built-package suites pass.
- [ ] Coverage and mutation changes are explained; no high-consequence survivor is dismissed without reproduction.
- [ ] Documentation, changelog and API stability are updated.
- [ ] No verification fixture was regenerated from the implementation under test.
- [ ] Any non-conformance record identifies its closure evidence and reviewer.

Author review is not independent V&V. Record the independent reviewer or
adopting-project acceptance separately when a release is being qualified.
