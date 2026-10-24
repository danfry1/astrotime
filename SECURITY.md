# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.13.x  | :white_check_mark: |
| < 0.13  | :x:                |

## Reporting a Vulnerability

Please report security issues privately, not in a public issue, discussion or pull request:

- **Preferred:** use GitHub's private vulnerability reporting. Open this repository's **Security** tab and choose **Report a vulnerability**, or go to <https://github.com/danfry1/astrotime/security/advisories/new>.
- **Alternatively:** email **security@danfry.dev**.

Include the version or commit, steps to reproduce, and the impact you expect.

You should expect an acknowledgement within 7 days, and credit in the advisory if you want it. If confirmed, a fix will be prioritized and released as a patch version, followed by a published security advisory.

## Supply-chain posture

- Zero runtime dependencies.
- All devDependencies are exact-pinned, enforced in CI by `syncpack lint`; the lockfile is committed and CI installs are frozen.
- Lifecycle scripts are not executed on install (`.npmrc ignore-scripts=true` for npm; Bun runs no untrusted lifecycle scripts by default and no `trustedDependencies` are declared); a 7-day minimum release age is enforced for new dependency versions.
- From v0.2.0, releases are staged to npm from CI via OIDC trusted publishing (provenance attached) and promoted only after a 2FA approval. v0.1.0 was the bootstrap release, published locally with 2FA and therefore without a provenance attestation.
- GitHub Actions are pinned to full commit SHAs. Workflows default to read-only tokens; the release pipeline's publish job holds only `id-token: write` (OIDC) and a separate job holds `contents: write` solely to create the GitHub release.
