---
id: decision-9
title: Pin NPM versions exact - no caret or tilde ranges
date: '2026-07-28 13:51'
status: accepted
---
## Context

Owner wants to avoid installing bleeding-edge versions with potential vulnerabilities or breaking changes. Wants explicit control over all dependency versions.

## Decision

`.npmrc` with `save-exact=true`. All versions in `package.json` are exact (e.g., `"next": "15.3.2"` not `"^15.3.2"`). Install latest stable minus one minor for major deps. pnpm lockfile is the ground truth.

## Consequences

- No surprise updates on `pnpm install`
- Manual version bumps required — use `pnpm outdated` periodically
- Combined with pnpm strict mode: reproducible installs
