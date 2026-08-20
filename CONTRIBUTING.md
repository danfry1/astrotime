# Contributing to astrotime

Thanks for your interest in contributing. This guide covers the development setup, workflow, and quality expectations.

## Setup

```bash
git clone https://github.com/danfry1/astrotime.git
cd astrotime
bun install
```

Requires [Bun](https://bun.sh/) and Node.js 22+.

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
| `bun run build` | Build with tsdown |
| `bun run check:package` | Build, pack, install the tarball in a temp dir and smoke-test it under Node |
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
- Run `bun run check:release` before opening a PR.
