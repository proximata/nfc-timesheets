# RECON — what is actually true at b0d078b

Written 2026-08-19 after a 7-phase run in which **Admin, Android and Verify died to transport**
("Subagent produced no assistant output") and left no report. Everything below was measured this
session: git, SSH into both boxes read-only, a restored production dump in a scratch database, a
headless browser against a local build, and the APK bytes themselves. Where something could not
be measured it says so in a word.

**Nothing was changed.** One source mutant was applied to prove a check goes red and was reverted;
`git status` is clean apart from the untracked `.field-recordings/`.

---

## 0 · The verdict, in four lines

```
the client's phone      ✗ BROKEN NOW.  0 worker_sessions in production, last worker request
                                       2026-08-15, and the shipped APK's API base is the tag
                                       host, which now 404s /roster and /shifts/open.
the code this run wrote ✓ present and green — server, admin, migration, probes all pass
production              ✓ healthy, 5 migrations, NOTHING from this run deployed
the decisions it obeys  ⚠ decision-41…44 are still `status: proposed`
```

The expensive finding is not in the code. It is that **the only live worker cannot clock in
today**, and that was true before this run started.

---

## 1 · What landed in git since 361e992

26 commits. Mapped to the seven phases, with the commit that proves each:

| phase | state | commits | evidence |
|---|---|---|---|
| **Host** | ✓ DONE | `106fc57` `5661d49` `d3cefcd` | `node ops/check-branding.mjs` → OK (9 assertions); `sh server/wellknown/verify.sh` → VERIFY OK; both association files + `/t` served from `timesheets.exe.xyz` with 0 redirects |
| **Triage** | ✓ DONE | `f2bf5d7` `2178d1d` | `backlog/docs/BACKLOG-TRIAGE-2.md` (267 lines, 58 verdicts); `task-189` filed |
| **Design** | ✓ DONE | `1efa6bc` `bce9646` `7d921cc` `7b56d53` | 4 decision records, `ZONES-MODEL.md` 1336+37 lines, TASK-190…203 with acceptance criteria |
| **Data** | ✓ DONE | `a835038` `8fe2071` `b161ec7` `a6e9c33` `e3c0b88` `452082e` | `server/check-api.js` → PASS; `check-prod-restore.mjs` → OK against the real dump |
| **Admin** | ⚠ PARTIAL — code green, unverified until now | `c41a6d7` `5fe485d` `195cd72` `d521d8f` `dc89d3c` `613b99c` `edf31d1` `33e5a47` `b0d078b` | `pnpm verify` exit 0; `probe-zones-revenue.mjs` all-pass; 12 map assertions SKIPPED |
| **Android** | ✗ NOT STARTED | none | `git log 361e992..HEAD -- android/` → only the two **Host** commits |
| **Verify** | ✗ NOT STARTED | none | no report, no deploy, no APK on any phone |

Two commits belong to neither phase: `fcb8e8a` + `8344f6b` wrote the five queued onboarding
workflows (`ops/workflows/`). They are scripts, not runs. Correctly not launched.

---

## 2 · The table — DONE / HALF-DONE / NOT STARTED / BROKEN

### 2.1 BROKEN — a client feels this

| # | what | evidence |
|---|---|---|
| **B1** | **The field phone cannot clock in.** `worker_sessions` in production has **0 rows**. `journalctl -u nfc-api` shows the last successful worker request at `Aug 15 15:43:45 … GET /roster 200 w=2` — on the host still named `timesheets`. Since the rename there has been exactly one app-side request: `Aug 19 10:26:35 POST /auth/code 401 err=unauthorized`. | measured on the box |
| **B2** | **…and it cannot re-enrol either.** The APK in `android/app/build/outputs/apk/debug/` (Aug 11 20:48, versionCode 1, the build that made the first Android clock-in) contains exactly one exe.xyz hostname across all nine dex files: `timesheets.exe.xyz`. That host is now the tag box: `GET /roster → 404`, `POST /shifts/open → 404`, `POST /auth/code → 404`, `nginx.conf:95 location / { return 404; }`. Every API call the shipped app makes lands on a 404. | `unzip -p … \| strings`, `curl` |
| **B3** | **Production's shift history was deleted.** The `2026-08-17T10:11Z` dump carries 5 workers, 16 shifts, 7 worker_sessions, 2 locations, 3 material_requests. The `2026-08-18T00:10Z` dump carries 1 worker, 0 shifts, 0 sessions, 1 location, 0 material_requests. No `DELETE /admin/*` traffic between them → a direct SQL reset, not the API. Consistent with "reset before onboarding", but it is not recorded anywhere, and the 17th's dump is the only copy — on the same `/dev/root` as the database (TASK-38). | two restored dumps |
| **B4** | **`demo/fix-mutants.sh` mutant `t176` is dead.** It asserts the string `const excludedCount = excludedShifts + noRateLines.length` exists in `web/app/payroll/page.tsx`. `5fe485d` deleted `noRateLines` per decision-41, so line 419 now reads `const excludedCount = excludedShifts` — which is that mutant's own **mutated** form. Ran it: `AssertionError: t176 site not found`. It was committed at `d521d8f` and invalidated by the next commit but one. | `sh demo/fix-mutants.sh t176` |
| **B5** | **The map has never drawn a pin for the owner.** Production's bundle contains no `AIza…` (fetched every JS chunk of the live index and grepped); `ops/deploy.sh` never sets `NEXT_PUBLIC_GOOGLE_MAPS_KEY`. TASK-16, still In Progress since 2026-08-04. | live `curl` |

### 2.2 HALF-DONE — everything compiles, and that is the trap

| # | what | evidence |
|---|---|---|
| **H1** | **decision-41, 42, 43, 44 are `status: proposed`.** ~4 000 lines of migration, server, admin and copy were built against them. `ZONES-MODEL.md §12.1 #1` says it in the design's own words: *"A build against a `proposed` record is a build against nothing."* decision-43 supersedes decision-37, which is `accepted` — so two accepted records currently disagree about whether a shift carries a zone. | `grep '^status:' backlog/decisions/*.md` |
| **H2** | **The grey pin is written and has never been observed.** `probe-zones-revenue.mjs` SKIPS `the grey pin` and `the info box of an unzoned pin` at all 3 widths × 2 themes = **12 assertions NOT PROVEN**. Rebuilt with the real key from `psst` and re-ran: still 0 pins. Cause measured in the browser — the key is referrer-restricted and rejects `127.0.0.1`: *"Der Kartenschlüssel wird für diese Adresse abgelehnt"*. So decision-43's colour-is-second-signal on the map cannot be proven on any machine we have. The fallback text and the Objektliste sentences **are** proven (2/2 unzoned rows carry the words at every width). | probe output, CDP |
| **H3** | **Migration 006 is written, gated, proven — and not applied.** `node server/db/check-prod-restore.mjs` against the real `2026-08-19` dump: *006 REFUSES (1 worker has no rate) → applies after the ops step → applies twice → the API boots → `POST /shifts/open` with the wall card's uuid returns 201, `start_zone_id null` → `POST /shifts/close` in the SHIPPED build's shape returns 200.* Production is still on **5** migrations and has no `zones` / `location_revenue` table. | check output, `schema_migrations` |
| **H4** | **006's blocker is real and is in production right now.** `workers` holds `id 6 · TTL Test · rate 0 · active f`. `006` §1 raises rather than inventing a wage. A human must set or remove it before any deploy. `ZONES-MODEL §12.1 #8` assumed *"Production has 0 workers, so 006 applies"* — that assumption is **false**, and only `check-prod-restore` caught it. | `psql` on the box |
| **H5** | **`demo/probe-zones-revenue.mjs` is an orphan.** 634 lines, ~90 assertions, referenced by **no** README, runbook, script or doc in the tree. Nothing will ever run it again by accident. | `grep -rn probe-zones-revenue` → only itself |
| **H6** | **TASK-190…203 are all `To Do` while 190–200 have shipped code.** So are TASK-156/157/158 (duplicates of 190/196/198). TASK-156…159 and 167 still carry *"(PROPOSED — do not build until the owner accepts it)"* in their bodies although decision-37 is accepted. An executor reading the board would rebuild what exists. | `grep -l '^status:' backlog/tasks/` |
| **H7** | **The triage proposed 24 deletions and 4 merges; none were applied.** Board is 121 tasks — 65 To Do, 8 In Progress, 48 Done. Fourteen redesign tasks (140–153) are still To Do for work that shipped at `b5c30fd`. | board vs `BACKLOG-TRIAGE-2.md §2` |
| **H8** | **`web/scripts/check.mjs` grew ~600 lines this run with no negative case.** `fix-mutants.sh` covers only the nine pre-existing fixes (and one of those is B4). The new zone/revenue/required-rate assertions in `check.mjs` have never been shown red. `probe-zones-revenue.mjs` **was** proven red — see §3. | file history |
| **H9** | **`KnownTags.kt` still hard-codes one serial.** Correct per its brief and per decision-44 (delete only after a zone carries the serial) — but no zone carries it, because zones do not exist in production. The upgrade path is written and unexecuted. | `KnownTags.kt:48` |

### 2.3 DONE — verified this session, not taken on trust

| # | what | evidence |
|---|---|---|
| D1 | Tag host serves all three files, right content types, **zero redirects** | `assetlinks.json` 200 `application/json`; AASA 200 `application/json`; `/t` 200 `text/html; charset=utf-8`; `num_redirects=0` on each. `server/wellknown/verify.sh` → VERIFY OK. Tag-host `/health` 200, everything else 404 |
| D2 | The API host serves the **same** association bytes as a fallback | 200 + `application/json` on both, per decision-40 |
| D3 | Nothing from this run is deployed | deployed `lib/reporting.js`, `lib/validate.js`, `routes/admin.js`, `routes/app.js` hashes ≠ HEAD and = pre-`8fe2071`; `schema_migrations` = 5; live bundle contains none of `Noch keine Zone`, `Nicht eingetragen`, `Zonen verwalten`, `je m²`; service last started `2026-08-19 02:01:50 UTC`, before this run's first commit |
| D4 | `pnpm verify` green | exit 0 — check + biome + tsc + build, 15 static routes |
| D5 | de/en **exact** key parity | 1173 keys each, 0 in de only, 0 in en only |
| D6 | Server suite green | `server/check-api.js` → PASS, including *"no route anywhere accepts a tag serial as INPUT"* and *"no zone name and no area ever reaches the client portal"* |
| D7 | Demo guards green | `sh demo/check-guards.sh` → 16 refusals + 60 files parse, OK |
| D8 | Admin screens green under the browser at 1680 / 1440×900 / **390**, dark + light | `probe-zones-revenue.mjs` — all non-skipped assertions pass; worst overflow `+0px` at every width; every drawer takes focus, traps it, closes on Escape and **restores focus to its opener** |
| D9 | Older audits still green | `check-money` `check-reports` `check-filters` `check-map-home` PASS; `audit-params` 60/60; `audit-icu` 17/17; `audit-german` 9/9; `audit-keyboard` 14/14 |
| D10 | Android logic checks green | `cd android && ./checks/run.sh` → `core-check: OK`, `known-tags-check: OK` |
| D11 | The Aug-19 release APK is correctly split | `dist/nfc-timesheets-0.2.0-3-release.apk`, versionCode 3: manifest `autoVerify` host = `timesheets.exe.xyz`; dex strings = `https://schimmer-glanz.exe.xyz` + `timesheets.exe.xyz`. It is **built, signed and on nobody's phone** |
| D12 | Wire compatibility with the shipped app survives 006 | `check-prod-restore` asserts `/roster` still building-shaped with `zones[]` additive-and-empty, `POST /shifts/open` 201 with the wall card's **building** uuid, `start_zone_id null` |

### 2.4 NOT STARTED

| # | what | evidence |
|---|---|---|
| N1 | **All of Android beyond the Host phase.** TASK-201 (any zone of the same building closes the shift; delete KnownTags), TASK-202 (put the APK on the field phone) | `git log 361e992..HEAD -- android/` → the two Host commits only. `grep -il zone android/…/*.kt` → one UI file, incidental |
| N2 | TASK-189 — `GET /shifts/mine` is iOS-only; an Android cleaner cannot see their own hours | `server/routes/app.js` serves it; no Kotlin caller |
| N3 | TASK-203 — the verification tap | `grep -rn 'verification tap\|testTap'` across web/ server/ → nothing |
| N4 | The Verify phase in full: no deploy, no field install, no report | — |
| N5 | The five onboarding workflows W1…W5 | `RUNBOOK.md`: *"None is launched."* Correct — they are queued behind this |

---

## 3 · The negative case, shown red

A check whose negative case cannot fail is not a check. The single most money-critical claim this
run makes is decision-42's *0,00 € is never the unknown*. It was seeded and shown red:

```
mutate  web/app/pl/page.tsx:788   {t('revenueNotEntered')}  ->  {money(0)}
build   pnpm build                                              exit 0   (it compiles — that is the point)
probe   node demo/probe-zones-revenue.mjs                       exit 1

FAIL 1680/dark  an unentered month says so and is never 0,00
      6 rows: 0 unentered, 2 typed zeros, 0 confusions
      0,00 € / 1.380,00 € / 420,00 € / 0,00 € / 960,00 € / 1.850,00 €
      (…and identically at 1680/light, 1440x900 ×2, 390 ×2 — 6 failures)

revert  cp /tmp/pl-page.orig.tsx …   ->  git diff clean, rebuilt green
```

The probe fires. `fix-mutants.sh` does not (B4), and the new `check.mjs` assertions were not
mutated (H8).

---

## 4 · Ranked — by what hurts the client, not by what is easy

Ranking is against the onboarding date, not against effort.

**1 · Get a working APK onto the field phone. Nothing else matters if a cleaner cannot clock in.**
B1 + B2 are live and compounding: the session is gone server-side *and* the installed build talks
to a host that 404s. The build that fixes it already exists (`dist/…-0.2.0-3-release.apk`,
versionCode 3, correct API host, Scan on the running screen, KnownTags). Order is load-bearing:
`adb install -r` (**never** uninstall — that wipes the session, and there is no session to keep
anyway, so a fresh enrolment code has to be issued either way), then a worker row with a rate,
then an enrolment code, then one real tap on the mounted EV1 serial, then read `journalctl` and
see `POST /shifts/open 201`. Not proven until that 201 exists. TASK-202 is the task; it is `To Do`.

**2 · Decide 41–44, in writing, before anything is deployed.** H1. The migration, the server,
the P&L, the workers screen and 1173 message keys are all downstream of four `proposed` records,
and one of them supersedes an `accepted` one. This is a one-word owner action and it gates
everything below. `ZONES-MODEL §12.1` is the eight-question form; question 6 (HOIV goes grey on
the map the day 006 lands) needs answering in the same breath.

**3 · Clear `TTL Test` on the box, then apply 006 — in that order, from the check.** H3 + H4.
`check-prod-restore.mjs` is the pre-flight and it has already run green against the real dump.
Take a fresh dump **off the box** first (B3: the only copy of the 16 deleted shifts shares a
filesystem with the database). Discovering the refusal mid-window is how a migration becomes an
incident; it has been discovered here instead.

**4 · Ship the maps key in `ops/deploy.sh`.** B5. The map is the landing surface (decision-39)
and the director has never seen a pin. One line. It also unblocks H2 — the grey pin can only ever
be observed on a real origin, because the key is referrer-restricted and will not load on
loopback.

**5 · Fix `fix-mutants.sh t176`.** B4. A mutant runner that aborts is worse than none: it looks
like tooling and proves nothing. Re-point it at whatever `excludedCount` means after decision-41,
or delete the case and say why in the commit.

**6 · Make the board match the tree.** H6 + H7. Move TASK-190…200 off `To Do` (Done where the
code + probe exist, In Progress with the remainder written where it does not). Strike the
"(PROPOSED)" line from 156–159/167 or an executor stops at it. Then apply the triage's 24
deletions — they were verified against code, not notes, and 14 of them are the shipped redesign.

**7 · Give `probe-zones-revenue.mjs` a home.** H5. Ninety assertions nobody will run again. One
line in `README.md`'s check table beside `check-guards.sh` and `check-captions.mjs`, with the
stack it needs (`DB nfc_demo`, API on `:4319` with `PUBLIC_DIR=../web/out`).

**8 · Mutate the new `check.mjs` assertions.** H8. Lower than 7 only because the probe — the
sharper of the two — has now been proven to fire.

**9 · Then, and only then, TASK-201 and a second physical tag.** N1. `ZONES-MODEL §11` risk 3
is explicit: a second active zone on a wall before the zone-aware APK is on the phone turns every
intra-building tap into `auto_closed = true` plus a new shift — unpaid work, resolved by hand,
per shift. Step 6 follows step 5. It has not.

**Not on this list, deliberately:** W1…W5. They are queued and they own `web/messages/*.json`,
`server/routes/admin.js` and `web/lib/nav.ts` — the files this run has just rewritten. Starting
one before the above is settled loses writes, which has already happened in this project.

---

## 5 · What did NOT happen

- **No application code was written.** One mutant, applied and reverted; `git status` is clean.
- **Production was not written to.** Read-only: `psql -Atc SELECT`, `journalctl`, `ls`,
  `sha256sum`, `systemctl show`. Two backups were **copied off** and restored into throwaway
  local databases; both were dropped. `/tmp/nfc-*.sql*` still holds client data on this laptop
  and should be removed.
- **Migration 006 was not applied anywhere but a scratch database.**
- **Nothing was deployed. No APK was installed. No tag was written.**
- **iOS was not touched** — `NFCTimeSheets/` and `project.pbxproj` unread and unmodified.
- **No task was created, closed or re-statused.** §4 rank 6 is the bookkeeping, and it is work,
  not a side effect of this document.
- **The grey pin remains unobserved** and is stated as unproven rather than as passing.
- **Which build is on the field phone is inferred, not measured** — no device was attached
  (`adb devices` empty). The inference is: any build ≤ `3cd1a5b` (2026-08-17) has
  `timesheets.exe.xyz` as its API base and is dead; a versionCode-2 build would reach the API but
  has no Scan on the running screen. Both are fixed by rank 1, so the ambiguity does not change
  the action — but it does mean the 201 in `journalctl` is the only acceptable proof.
