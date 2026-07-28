---
id: TASK-4
title: Serve AASA from exe.xyz server
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-07-28 14:45'
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
- [ ] #1 curl -I returns 200 + application/json for AASA
- [ ] #2 AASA JSON contains correct appIDs with team 6Y842FE8Q4
- [ ] #3 /t returns HTML landing page
- [ ] #4 iOS entitlements file updated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SCOPE ADDITION (decision-16, Android research): serve BOTH association files from this server.

1. /.well-known/apple-app-site-association
   - Content-Type: application/json  (NOT application/pkcs7-mime, NOT text/plain)
   - NO redirect. NO .json extension on the path.
   - appID: 6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets
   - paths: ["/t*"]   (decision confirmed /t, NOT /hello)

2. /.well-known/assetlinks.json   <- NEW, for future Android (research/android-path.md)
   - Content-Type: application/json, no redirect
   - ~5 lines while already in this file. Skipping it means reopening the worker later.
   - package_name io.github.qwadratic.NFCTimeSheets, sha256_cert_fingerprints [] until an
     Android signing key exists - ship the file with an empty fingerprint array now.

3. GET /t  -> landing page. Only ever hit when the app is NOT installed (iOS intercepts
   otherwise). Keep it a static page telling the worker to install the app.

VERIFY (must pass before TASK-6 writes any tag):
  curl -sI https://timesheets.exe.xyz/.well-known/apple-app-site-association | grep -i content-type
  curl -sI https://timesheets.exe.xyz/.well-known/assetlinks.json | grep -i content-type
  # both must be application/json, both must be HTTP 200 with no 3xx hop

decision-4 CONFIRMED unchanged by the research cycle - the brief only wanted to move AASA to
Cloudflare because it assumed a company-owned domain, which decision-15 declined. Cloudflare
Workers cannot serve exe.xyz (not our zone). See backlog/docs/BLOCKER-aasa-host-vs-cloudflare.md
<!-- SECTION:NOTES:END -->
