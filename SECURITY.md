# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly by emailing **danf@hotmail.co.za** instead of opening a public issue.

You should expect a response within 48 hours. If confirmed, a fix will be prioritized and released as a patch version.

## Supply-chain posture

- Zero runtime dependencies.
- All devDependencies are exact-pinned; the lockfile is committed and CI installs are frozen.
- Lifecycle scripts are not executed on install (`.npmrc ignore-scripts=true` for npm; Bun runs no untrusted lifecycle scripts by default and no `trustedDependencies` are declared); a 7-day minimum release age is enforced for new dependency versions.
- From v0.2.0, releases are staged to npm from CI via OIDC trusted publishing (provenance attached) and promoted only after a 2FA approval. v0.1.0 was the bootstrap release, published locally with 2FA and therefore without a provenance attestation.
- GitHub Actions are pinned to full commit SHAs. Workflows default to read-only tokens; the release pipeline's publish job holds only `id-token: write` (OIDC) and a separate job holds `contents: write` solely to create the GitHub release.
