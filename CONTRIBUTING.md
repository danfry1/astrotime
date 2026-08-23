# Contributing to astrotime

Thanks for your interest in contributing. This guide covers the development setup, workflow, and quality expectations.

## Setup

```bash
git clone https://github.com/danfry1/astrotime.git
cd astrotime
bun install
```

Requires [Bun](https://bun.sh/) and Node.js 24.15+ (the pinned npm 12 toolchain needs `^22.22.2 || ^24.15.0 || >=26`). The published package itself supports Node 22+.

## Development commands

| Command | What it does |
|---------|-------------|
| `bun run test` | Run all tests (includes astropy golden/drift vectors and fast-check properties) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage and enforce thresholds (also runs in CI) |
| `bun run bench` | Run vitest benchmarks |
| `bun run lint` | Lint with oxlint (type-aware) |
| `bun run format` / `format:check` | Format with oxfmt |
| `bun run typecheck` | Type-check with tsc |
| `bun run knip` | Check for dead files, exports, and dependencies |
| `bun run check:complexity` | Enforce the ≤15 normal McCabe ceiling on every production function |
| `bun run build` | Build with tsdown |
| `bun run check:package` | Build, pack, install the tarball in a temp dir and smoke-test it under Node |
| `bun run test:differential` | Compare 100,000 seeded epochs against pinned Astropy/ERFA (requires `astropy==6.0.1`) |
| `bun run test:mutation` | Run the complete Stryker campaign and provenance-stamp its report |
| `bun run check:release` | Everything CI runs before a release |

## Correctness ground truth

Time-scale conversions are tested against reference vectors generated with
[astropy](https://www.astropy.org/) (ERFA/SOFA):

```bash
pip install astropy==6.0.1 spiceypy==6.0.0
python3 scripts/generate-golden.py > tests/fixtures/astropy-golden.json
python3 scripts/generate-drift.py  > tests/fixtures/astropy-drift.json
curl -sLO https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls
python3 scripts/generate-spice.py naif0012.tls > tests/fixtures/cspice-golden.json
```

CI installs astropy from `scripts/requirements-differential.txt`, a hash-pinned
set generated with `uv pip compile --generate-hashes`, so every wheel behind the
differential sweep is verified before it runs. Regenerate that file whenever the
astropy pin changes; the command is in its header.

If you change any conversion code, the fixtures must still pass unchanged.
If you regenerate fixtures, say so in the PR and explain why.

The bundled leap-second table (`IERS_LEAP_SECONDS` in `src/leap-seconds.ts`)
mirrors the IANA `leap-seconds.list`; a monthly CI job fails when they drift
or when the Bulletin C expiry is near. Update the table and the two fixture
files together.

## Guidelines

- Zero runtime dependencies is a hard rule.
- Expected failures return `Result`; only programmer errors throw (`RangeError`).
- Every exported function needs a JSDoc comment and tests, including edge cases
  (leap seconds, negative times, non-finite input).
- No production function may exceed normal McCabe complexity 15. Refactor the
  design rather than waiving the gate.
- A behavior or accuracy change updates its `REQ-*`, affected `HAZ-*`,
  traceability mapping and regression evidence. Findings follow
  `NONCONFORMANCE.md`.
- Do not describe ordinary branch coverage as MC/DC. Safety classification and
  MC/DC acceptance belong to the adopting project's independent assurance
  process.
- Run `bun run check:release` before opening a PR.
