---
id: TASK-32
title: White-label operator identity as configuration
status: Done
assignee: []
created_date: '2026-08-04 16:52'
updated_date: '2026-08-04 16:52'
labels:
  - infra
  - ops
dependencies: []
priority: high
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retro-filed 2026-08-04 during backlog triage. Work shipped in commit 9fcb2f4; rationale is decision-24.

Operator identity (tag host, Apple team id, bundle ids, AASA paths, Android package, signing fingerprints) moved out of source and into one configuration file, so shipping under a different signing identity is an edit plus a regeneration rather than a hunt through Swift, Kotlin, JSON and shell.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ops/branding.json is the single source of operator identity
- [x] #2 The two well-known files are GENERATED from it and committed, never hand-edited
- [x] #3 The AASA appID list is append-only
- [x] #4 The iOS Associated Domains entitlement stays a checked-in literal
- [x] #5 A check refuses a mismatch, and a rebrand runbook exists
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EVIDENCE.
- ops/branding.json holds host, appName, apple.teamId 6Y842FE8Q4, apple.bundleIds,
  apple.paths ["/t*"], android.packageName, android.sha256CertFingerprints [].
- Generator ops/gen-wellknown.mjs; gate ops/check-branding.mjs. I ran it:
    ok   android/branding.properties matches ops/branding.json
    ok   team id 6Y842FE8Q4 appears in no source file
    ok   host timesheets.exe.xyz has one home in Swift (Branding.swift)
    check-branding: OK          (exit 0)
- ops/deploy.sh runs BOTH as step 0/7, before the build and before any rsync — deliberately,
  because a served association file that does not name this app is the one failure in this
  product that costs a site visit to every building.
- Append-only is ENFORCED, not documented: the generator refuses to drop a bundle id without
  --allow-removal, because Apple caches AASA and an installed app holds its association until
  reinstall. Removing an id bricks every installed copy.
- The entitlement is deliberately NOT templated: an unconfigured build would emit a bare
  "applinks:" and kill universal links silently.
- Live proof the generated files are the served files: the AASA at timesheets.exe.xyz returns
  exactly the appID in branding.json, and assetlinks.json returns exactly the package name.
- Runbook: ops/REBRAND.md. Second gate: server/wellknown/verify.sh.

The empty sha256CertFingerprints array is correct and load-bearing — see the Android release
task. Android App Links stay unverified until BOTH the upload key and the Play App Signing key
fingerprints are listed, and a lowercase fingerprint is valid JSON that Android silently
ignores, which is why the format is validated.
<!-- SECTION:NOTES:END -->
