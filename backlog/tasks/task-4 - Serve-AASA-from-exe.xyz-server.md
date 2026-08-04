---
id: TASK-4
title: Serve AASA from exe.xyz server
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:46'
labels:
  - infra
  - ios
milestone: m-0
dependencies:
  - TASK-3
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Server responds to GET /.well-known/apple-app-site-association with correct JSON, Content-Type application/json, no redirect. Serve /t as landing page. Update iOS Associated Domains entitlement to new exe.xyz hostname.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 curl -I returns 200 + application/json for AASA
- [x] #2 AASA JSON contains correct appIDs with team 6Y842FE8Q4
- [x] #3 /t returns HTML landing page
- [x] #4 iOS entitlements file updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, verified by curl against production.

AC1 + AC2:
  $ curl -sSi https://timesheets.exe.xyz/.well-known/apple-app-site-association
  HTTP/2 200 ; content-type: application/json ; no 3xx hop
  {"applinks":{"details":[{"appID":"6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets","paths":["/t*"]}]}}

Scope addition also live:
  $ curl -sSi https://timesheets.exe.xyz/.well-known/assetlinks.json
  HTTP/2 200 ; content-type: application/json
  package_name io.github.qwadratic.NFCTimeSheets, sha256_cert_fingerprints [] (empty on purpose
  until an Android signing key exists — see the Play release task).

AC3: `GET /t?l=<uuid>` -> 200 text/html, the install-the-app landing page, no JS, no external
assets.

AC4: NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements carries `applinks:timesheets.exe.xyz`
as a checked-in literal, deliberately not templated (decision-24).

Both files are now GENERATED from ops/branding.json by ops/gen-wellknown.mjs and gated by
`node ops/check-branding.mjs` (ran it: `check-branding: OK`, exit 0).
<!-- SECTION:NOTES:END -->
