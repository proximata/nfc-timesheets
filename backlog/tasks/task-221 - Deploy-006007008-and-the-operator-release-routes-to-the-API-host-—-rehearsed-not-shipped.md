---
id: TASK-221
title: >-
  Deploy 006+007+008 and the operator/release routes to the API host —
  rehearsed, not shipped
status: Done
assignee: []
created_date: '2026-08-20 21:16'
updated_date: '2026-08-20 21:45'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SHIPPED 2026-08-20 21:25Z. Production is at 8 migrations; every route that answered 404 now answers.

BACKUP FIRST: nfc-20260820T211911Z.sql.gz via the box's own nfc-backup.service, 4960 B, gzip -t OK, carries the HOIV row; restore-test.sh PASSED on it before anything moved. A second backup was taken after the deploy: nfc-20260820T213716Z.sql.gz (6706 B), also restore-tested.

DEPLOY: ./ops/deploy.sh, unmodified path. schema_migrations 5 -> 8 (006 21:25:39.729, 007 .801, 008 .870). Five new tables created EMPTY: zones, location_revenue, operators, reported_tags, tag_aliases, plus phone_identities and operator_sessions. routes/operator.js and routes/release.js are on the box.

ONE BLOCKER FOUND AND FIXED IN FLIGHT: step 0b's --dry-run gate refused the deploy with 'ERROR: relation "operators" does not exist'. Nothing was wrong with 008 — the runner dry-ran each pending file in ITS OWN rolled-back transaction, so 008's FKs met a database where 007's CREATE had just been undone. migrate.js now dry-runs all pending files in ONE transaction, in order, and names the offending file via \echo markers instead of a psql line number. Both mutants shown red (c22f931).

APK PUBLISHED: nfc-timesheets-0.4.1-6-release.apk at /srv/nfc/releases/, manifest derived from the APK's own binary manifest with apkanalyzer (versionCode 6, versionName 0.4.1) and never from the filename. GET /app/download serves 1728043 bytes, sha256 bf3ff8be...9a09, byte-for-byte identical to android/dist/. ops/publish-apk.sh does the publish and the read-back; deploy.sh step 3 now excludes releases/ or --delete would wipe the APK every deploy and leave a manifest naming a missing file. Four negative cases shown red: wrong sha, missing file, malformed manifest, mislabelled artefact.

VERIFY OK on both hosts: schimmer-glanz.exe.xyz (--host-override) and timesheets.exe.xyz — both association files 200, application/json, 0 redirect hops, bodies byte-identical to the reviewed files; /t 200 text/html.

LIVE SMOKE, 82 assertions, 0 failures (ops/smoke-live.sh): 16 admin pages, every admin read route, 10 auth gates refusing, operator create -> enrolment code -> /auth/operator-code -> POST /operator/tags (201 then 200, one row, UNBOUND), worker create -> /auth/code -> roster, OLD-SHAPE POST /shifts/open on the wall uuid -> 201 with start_zone_id NULL and idempotent on replay, the unbound tag -> 422 tag_unbound with no shift row, admin resolve-zone -> the tap then 201 carrying start_zone_id. Every row it created was deleted from a trap and the counts re-read: 0 workers, 0 operators, 0 shifts, 0 zones, 0 reported_tags, 1 locations, 1 admins. HOIV: hoiv-arsenalstrasse-11, active, 48.1761151/16.3953038 — unchanged. Red-first: the wall building deactivated, a second building seeded, the version document removed.

STILL NOT PROVEN: nothing has been tested on real hardware — no phone, no card. CORE-FLOW §4 is still the field script, and step 1b (a mounted card must be refused) is the one that needs a human.
<!-- SECTION:NOTES:END -->
