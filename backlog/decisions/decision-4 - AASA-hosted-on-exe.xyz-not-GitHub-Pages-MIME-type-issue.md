---
id: decision-4
title: AASA hosted on exe.xyz (not GitHub Pages - MIME type issue)
date: '2026-07-28 13:51'
status: accepted
---
## Context

Apple-app-site-association must be served with `Content-Type: application/json`. GitHub Pages doesn't allow specifying response MIME types — owner already ran into this issue. AASA was previously on `qwadratic.github.io`.

## Decision

Serve AASA from the same exe.dev VM at `timesheets.exe.xyz/.well-known/apple-app-site-association`. Server explicitly sets Content-Type header. iOS app entitlement updated to `applinks:timesheets.exe.xyz`.

## Consequences

- Full control over response headers
- Single point of failure (if server down, no new AASA fetches) — acceptable, AASA is cached by Apple CDN at app install time
- NFC tags get URIs pointing to `timesheets.exe.xyz/t?l=<ID>`
