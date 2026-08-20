---
id: TASK-221
title: >-
  Deploy 006+007+008 and the operator/release routes to the API host —
  rehearsed, not shipped
status: To Do
assignee: []
created_date: '2026-08-20 21:16'
labels:
  - ops
  - deploy
  - data-safety
dependencies: []
priority: high
ordinal: 139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Production is three migrations and two route files behind this repo. Four of the six things the owner needs are finished and answer 404 in the field: self-update (GET /app/version), the tag report (POST /operator/tags), operator enrolment (POST /operator/enrol), and the admin resolve (POST /admin/tags/:id/resolve-building). The /tags/ admin page 404s too.

BOTH BLOCKERS ARE CLEARED as of 2026-08-20:
  - decisions 41-44 ACCEPTED, 37 marked superseded with the note in its own file (8aa9e8f)
  - production workers id 6 'TTL Test' rate 0 DELETED (ops/delete-worker.sql, backup nfc-20260820T210658Z.sql.gz taken and restore-tested first). workers is now EMPTY; the box reports '006 rate guard: 0 rate-less workers remain'.

REHEARSED GREEN against a restored dump taken AFTER the delete (nfc-20260820T210724Z):
  node server/db/check-prod-restore.mjs  -> 006->007->008 in order, twice, zero rows invented, every pin intact, API boots, the SHIPPED APK's POST /shifts/open on the wall UUID -> 201, an unbound reported tag -> 422 tag_unbound with no shift, the mounted EV1 serial resolves end to end
  sh   server/db/check-prod-restore-mutants.sh -> 3 red
  node ops/check-hoiv-survives-006.mjs   -> HOIV unzoned, grey, pinned and TAPPABLE; 3 mutants red
  node server/db/check-field-wire.mjs, node server/check-phone-namespace.mjs, node ops/check-reset-w1.mjs (+ mutants) -> all OK

RUN IT: ./ops/deploy.sh. Step 0a stages the migration files BEFORE the dry-run gate for exactly this window; do not skip it. Take a fresh pg-backup.sh + restore-test.sh immediately before.

ACCEPTANCE EVIDENCE: schema_migrations = 8 on the box; GET /app/version, POST /operator/enrol and GET /tags/ stop answering 404; and the FIRST thing checked after the restart is that a tap on the HOIV card still opens a shift.

MUST NOT REGRESS: the OLD-SHAPE POST /shifts/open from the APK in the field must still open a shift; clock-in is never blocked by anything; HOIV stays active with lat/lng 48.1761151/16.3953038.

NOT DONE HERE, on purpose: nothing was deployed and nothing on the VM was changed except the workers row deletion.
<!-- SECTION:DESCRIPTION:END -->
