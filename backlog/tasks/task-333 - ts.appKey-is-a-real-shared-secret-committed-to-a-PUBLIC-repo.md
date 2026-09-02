---
id: TASK-333
title: ts.appKey is a real shared secret committed to a PUBLIC repo
status: To Do
assignee: []
created_date: '2026-09-02 06:03'
labels: []
dependencies: []
priority: high
ordinal: 251000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while writing decision-70 §3, which had wrongly called the Sentry DSNs 'the same trust tier as ts.appKey'. They are not: a DSN is a write-only ingest endpoint, whereas ts.appKey (android/branding.properties:43) is the shared build secret sent as the X-App-Key header on every request. proximata/nfc-timesheets is PUBLIC, so that value is world-readable, and it is also in git history (removing it from HEAD does not remove it from the repo). PRE-EXISTING - decision-70 neither created nor blessed this; it only stopped mis-describing it. Server side: server/lib/auth.js checks X-App-Key. Scope the fix with how much the key actually buys an attacker (it gates the 'app' auth kind, not a worker/admin session), which decides whether this is urgent or merely untidy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Establish what possessing ts.appKey actually grants against production today: which routes accept auth kind 'app' with no session, and what an unauthenticated caller can do with them
- [ ] #2 Decide and record: rotate the key and inject it at build time from a CI secret (as WEB_SENTRY_DSN already does for web), or accept it with a written reason
- [ ] #3 If rotating: the value must leave HEAD AND git history, or the rotation is theatre - history rewrite plus force push, same as TASK-239 AC3
- [ ] #4 psst pre-commit hook still flags branding.properties on every touch; make sure the outcome does not depend on a human choosing correctly under a bypass prompt
<!-- AC:END -->
