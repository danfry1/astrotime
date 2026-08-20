# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly by emailing **danf@hotmail.co.za** instead of opening a public issue.

You should expect a response within 48 hours. If confirmed, a fix will be prioritized and released as a patch version.

## Supply-chain posture

- Zero runtime dependencies.
- All devDependencies are exact-pinned; the lockfile is committed and CI installs are frozen.
- `ignore-scripts=true` for installs; a 7-day minimum release age is enforced for new dependency versions.
- Releases are staged to npm via OIDC trusted publishing (provenance attached) and promoted only after a 2FA approval.
- GitHub Actions are pinned to full commit SHAs and run with read-only tokens.
