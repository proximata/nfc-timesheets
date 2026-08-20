# VERIFY-FINAL — the one verdict, at 8702615

Last reader before the owner. Three probes — **data**, **money**, **surface** — re-tested a run
whose own verification agent timed out. This file reconciles them, re-measures where two of them
disagreed, separates DEFECTS from UNOBSERVED, and ranks by what it costs the client.

Everything below was measured this session on this laptop unless it says otherwise.
**Production was read, never written.** `curl` on both hosts and on 13 live JS chunks. No SSH, no
`psql`, no migration, no deploy, no APK install, no tag written, no iOS file modified.

---

## 0 · Verdict

```
the code this run built    ✓ correct. 4000 lines, and no product defect survived re-test
the checks guarding it     ⚠ eight holes, all found by mutation, all closed this round
the client's phone         ✗ STILL BROKEN, and the fix is built and on nobody's phone
the director's map         ✗ STILL BLANK, and the missing step is NOT in this repo
decisions 41…44            ⚠ still `proposed`, and 43 supersedes the ACCEPTED 37
production                 — untouched. 5 migrations, no zones table, none of this deployed
```

Two of RECON's findings and one of the money probe's did not survive re-test. They are §1.

---

## 1 · Reconciliation — where two reports disagreed, I re-measured

### 1.1 The grey pin. SURFACE was right; RECON H2 and the money probe were wrong.

The disagreement was total. RECON H2 and the money probe: *"12 map assertions still SKIPPED and
NOT proven… the key is referrer-restricted and draws no pin on 127.0.0.1."* SURFACE: *"OBSERVED,
both themes, 1680 + 1440."*

Re-measured from scratch — key out of `psst`, `pnpm build` with it, `assertMapKeyInBuild()` green
(2 chunks carry `AIzaSy`), API on **:8080**:

```
1680/dark  a pin is grey and SAYS the word, or it is neither
           5 pins drawn · 1 unzoned+pinnable · 1 grey · 1 carrying the word        ok
1680/dark  the info box hangs off a pin that is grey AND says the word
           306px, grey=true, word=true — Wohnhaus Wagramer Strasse                 ok
1680/light · 1440x900/dark · 1440x900/light                       identical         ok
390/dark · 390/light                                              4 SKIP
```

**SURFACE is confirmed.** decision-43's *colour is the second signal* is proven on the map.

The mechanism, so it cannot recur: the browser key's allowlist contains
`http://127.0.0.1:8080/*` — **that origin and that port**. The money probe ran its server on
`:4319`, got `RefererNotAllowedMapError`, drew no pin, and read four SKIPs as the twelve RECON
had reported. It is not 12 and it is not a key restriction; it is a port. `README.md` now says so
and `demo/build-guard.mjs` throws instead of letting it go quiet.

The 4 remaining SKIPs are at **390 only** and are principled, not a hole: the map is collapsed on
a phone by design and the Objektliste IS the surface there — *"every unzoned building says so in
the Objektliste, in words — 2/2 rows"*, both themes. Stated as unproven, not as passing.

### 1.2 `demo/fix-mutants.sh t176`. The money probe was right; RECON B4 is stale.

RECON B4: the mutant is dead, `AssertionError: t176 site not found`. Re-ran it with the key
exported (without one it now **refuses**, which is itself the surface round's fix):

```
=== MUTANT t176 · „Nicht gezählt" gains a phantom +1 no shift backs ===
  ok   t176 goes RED without the fix (1 failed assertion(s)):
         FAIL payroll: „Nicht gezählt" IS the shift count, not merely near it
  ok   web/ is clean again and rebuilt from the fixed source
fix-mutants: every negative case fires.
```

**B4 is fixed and verified**, not assumed.

### 1.3 Android. RECON N1 is stale — the zone path shipped.

RECON: *"All of Android beyond the Host phase: NOT STARTED."* Eight commits landed after RECON
was written (`20a5d6e` `e950f7f` `66d1445` `ad2cd35` `e2feae2` `c0cac05` `4ea9187` `7d4d2fc`
`71df8b3`). Measured on the artefact rather than the tree:

```
android/app/build/outputs/apk/release/app-release.apk      2026-08-20 00:05
aapt2      versionCode 4 · versionName 0.3.0 · io.github.qwadratic.NFCTimeSheets
apksigner  CN=NFC TimeSheets, OU=HOIV — SHA-256 6c78…996c
           = the single fingerprint in ops/branding.json, i.e. what assetlinks.json publishes
manifest   every android:host under autoVerify = timesheets.exe.xyz (×4, the PERMANENT tag host)
dex        schimmer-glanz.exe.xyz + timesheets.exe.xyz · zones · tag_serial · auto_closed
checks     cd android && ./checks/run.sh → core-check OK (311) · known-tags-check OK (27)
```

**The zone-aware APK exists, is signed with the right key, and autoVerifies only the permanent
host.** `dist/` does not exist — the path `android/README.md` promises the deliverable at is
empty; the bytes are at `app/build/outputs/apk/release/app-release.apk`.

**And it is safe to install BEFORE the server is migrated**, which nobody had stated. `Wire.kt`
reads the roster's zone array with `optJSONArray`, never `getJSONArray`, and `core-check.kt`
asserts it: *"a zones-less roster still decodes its locations"*, *"a missing `zones` key degrades
to an empty list, never a throw"*. Proven at the parser on a plain JVM. **Never on a phone.**

---

## 2 · DEFECTS — ranked by what it costs the client

### D1 — The cleaner still cannot clock in. Live now. `TASK-202`

Measured live this session, read-only:

```
https://timesheets.exe.xyz/roster                → 404   (tag host: three static files + /t)
https://schimmer-glanz.exe.xyz/roster            → 401   (API host: alive, wants a session)
https://timesheets.exe.xyz/health                → 200   ← the only thing that answers there
```

The build on the field phone points at the tag host. Every API call it makes lands on a 404. The
fix is **built, signed and on nobody's phone** (§1.3). Nothing else on this list matters if a
cleaner cannot start a shift, and this has been true since the host rename on 2026-08-19.

Order is load-bearing and is written into TASK-202: `adb install -r` (never uninstall), a worker
row **with a rate**, a fresh enrolment code, one real tap, then `POST /shifts/open 201` in
`journalctl`. Not proven until that 201 exists.

### D2 — The director's map has never drawn a pin, and the fix is two steps, not one. `TASK-206`

```
live: 13 chunks off https://schimmer-glanz.exe.xyz/ — occurrences of AIzaSy: 0
node demo/check-map-key.mjs
  FAIL  https://schimmer-glanz.exe.xyz/  canvas=0 pins=0 RefererNotAllowedMapError
  ok    https://timesheets.exe.xyz/       canvas=1 pins=5
```

RECON rank 4 said *"ship the maps key in `ops/deploy.sh`. One line."* **Wrong as written.** One
line ships a bundle that loads Maps and is refused by Google, because the key's referrer
allowlist does not contain the API host. The console step is **not in this repo**, which is why
no grep could have caught it. Both steps, and the order, are in TASK-206 — including *keep
`http://127.0.0.1:8080/*`*, because removing it silently disarms every local map assertion.

The map is decision-39's landing surface. What the director sees today is the no-map rendering.

### D3 — Every building row on the director's screen says `no_key`. `TASK-181`, unchanged

```
web/messages/de.json:165   "objectsGeoFailed": "Keine Koordinaten · {status}"
web/components/Objektliste.tsx:80  t('objectsGeoFailed', { status: building.geocodeStatus … })
```

The raw server token is interpolated straight into German prose. With no map key configured the
status **is** `no_key`, so this is what production prints on every unpinned building. Confirmed
still present at HEAD; the task was already filed and is correctly still To Do. It compounds D2:
the map is blank *and* the list says why in a word the director cannot act on.

### D4 — `labour_seconds = 1, labour_cents = 0` reaches `/admin/pl`. `TASK-204`

Re-measured independently, end to end, not taken from the data probe:

```
scratch copy of nfc_demo, one shift of exactly 1 second at Wohnhaus Wagramer Strasse
GET /admin/pl?from=2026-08-20T01:39:00Z&to=2026-08-20T01:40:00Z
  → Wohnhaus Wagramer Strasse   labour_seconds = 1   labour_cents = 0
```

`server/lib/reporting.js:308-310` states the invariant in its own comment; `check-api.js:3126`
asserts it; **the assertion passes only because no fixture ever totals one second.** Scratch DB
dropped.

**Its ceiling, stated plainly, because two reports headlined this and neither bounded it.** The
cause is `ROUND()` to the nearest cent, not a missing rate. The error is at most **half a cent
per (worker, building, period)** — with 7 workers over 6 buildings, under 21 cents a period, in
either direction. It is **invisible on screen**: one second renders as `0,00` hours as well as
`0,00 €`, so no screen shows worked time priced at nothing. It is a broken invariant, not a
figure that misleads about money. Medium, and correctly filed as medium.

decision-41's original cause **is** unrepresentable and the deleted `Kein Stundensatz` copy stays
deleted — omitted `23502`, NULL `23502`, 0/negative `23514`, edit-to-zero `23514`, `422
rate_required` on both upsert branches, constraint `convalidated`, no import path exists, delete
is soft. Verified. It is the *broader sentence* that is still falsifiable.

### D5 — Eight checks that were not checking. All closed this round.

Every one was found by mutation and every one was shown RED before it was believed.

| # | the hole | what got past it |
|---|---|---|
| 1 | `check-revenue-unknown` keyed amounts as `(route,'','')` and used a **Set** as its oracle, so one true zero forgave every zero at that key | `/pl/`'s answer band → `money(revenueCents ?? 0)`, on 3 routes, swept and counted, reported *"0 new"* — the cell the file's own comment calls the one a director reads FIRST |
| 2 | CSV filename asserted by shape: `/^payroll-\d{4}-\d{2}-\d{2}\.csv$/` | `businessDate` → raw UTC slice ⇒ `payroll-2026-06-30.csv` for **July's** payroll, matching the regex exactly |
| 3 | nothing asserted screen == server aggregate; `check-reports` asserted *which branch count*, never *which branch* | per-shift instead of per-worker rounding: 387451 → **387477**. `web/scripts/check.mjs`, the unit suite that owns `lib/payroll.ts`, passed it clean |
| 4 | *"/pl/ derives the SAME area as /locations/"* compared the server against zone rows it re-derived itself | `sumArea`'s incomplete branch deleted ⇒ `/locations/` prints "980 m² gesamt" for a building with an unmeasured Tiefgarage while `/pl/` says `area_incomplete` — green **under its own title** |
| 5 | the money surface grep only recognised `Intl` currency | `centsToPlainEuros` (the CSV path) was silently out of scope |
| 6 | three i18n checks compared arguments, and a plural's branches are not arguments | `{count, plural, other {# Schichten}}` → „1 Schichten" passed all three |
| 7 | `check-close-flag.mjs` greps for `auto_closed = auto_closed OR $3` and evaluates a JS truth table. **It never opens a connection.** | 7 PASS over a line no code path can execute — both writers set `end_time` in the same statement that raises the flag, so the left operand is always false. Mutate the OR away → check-api PASS, check-field-wire PASS. `TASK-205` |
| 8 | `check-prod-restore.mjs` printed a raw `ERR_MODULE` stack on a machine with no local `nfc` role, and `process.exit()` skipped the `finally` that drops the restored database | a failed pre-deploy check left a copy of the client's payroll on the laptop — the one thing its own header promises not to do. Fixed at `9072a8e`: named FAIL, exit 1, database dropped |

Two more, closed by the surface round and re-verified here: `check-ia-greyscale` was failing on a
clean tree for a **non-defect** (`audit-keyboard`/`audit-overlays` write to `nfc_demo` and resolve
the seed's unresolved shifts) — now a precondition failure that names itself and prints the
reseed; and the light theme had been measured at **1 width of 11**, pinned by the wrong
`localStorage` key (`ts-theme` ≠ `nfcts.theme`), so 132 measurements labelled "light" were dark.

Live demonstration of the guard that ties this together, run at the end of this session:

```
cd web && pnpm verify                  → exit 0, and it rebuilds web/out WITHOUT the key
node -e "assertMapKeyInBuild()"        → build-guard: web/out was built WITHOUT
                                         NEXT_PUBLIC_GOOGLE_MAPS_KEY.
```

That is the exact sequence that produced RECON H2's false finding, and it now throws.

### D6 — The deploy window no health probe can see. Shape, not an open incident.

HEAD's `activePlace` SELECTs from `zones`. Booted against the 005 schema production has today:

```
GET  /health       200   ← it only runs SELECT 1
GET  /roster       500   relation "zones" does not exist
POST /shifts/open  500   relation "zones" does not exist       0 rows written
```

`ops/deploy.sh` migrates (step 5) before it restarts (step 6) and now stages + dry-runs the
migration first, so the ordering is right. The residual window is a crash between the code rsync
and the migration. **`/health` cannot see it. Only a cleaner can.** Asserted in
`check-field-wire.mjs`. `ops/deploy.sh` was read, never run.

### D7 — Browser checks default to six different dead ports. `TASK-209`, low.

`8080 · 8082 · 8083 · 8091 · 8092 · 8093`, against a README that says all of them want `:8080`
and says why. Pointed at a dead port they die with
`TypeError: Cannot read properties of null (reading 'focus')`. Exit code **1**, so nothing passes
vacuously — that is why it is low, not high. But it is the same class `9072a8e` fixed: an
operator reads a stack trace as *"the tooling is broken"*. It cost this run two dead check-runs.

### D8 — Overlapping runs share one git index, one working tree, and two fixed ports. `TASK-210`

Observed three times in one night, by two different runs:

```
03:58  web/app/pl/page.tsx held another run's LIVE UNCOMMITTED mutant —
       t('revenueUnknown') → money(0), decision-42's exact violation
04:2x  three files staged by one run went out inside another run's commit 6757082
05:06  an orphan headless Chrome on :9341 and an orphan server on :8080. launchChrome()
       polled /json/version, got the ORPHAN's answer, attached to a dead target:
       "Error: Promise was collected". Cost this run its first probe attempt.
```

*"Never `git add -A`"* is **necessary and not sufficient**: staging a path stages a path,
committing without a pathspec commits the whole shared index. `demo/build-guard.mjs`'s
`assertFreshServer` exists because the server half of this already produced a false GREEN.

**The money probe's report is not on disk.** `backlog/docs/` has `PROBE-DATA.md` and
`SURFACE-PROBE.md` and no money equivalent; the four holes it closed live in the checks
(`9d64717` `8dbee20` `6757082` `6956455` `c606cf5`) and its narrative existed only in the run
transcript. It is carried in §D5 rows 1–5 of this file, which is now its only home. Worth noting
that all five of those commits touch **checks only** — the money probe changed no application
code, which is its own verdict confirmed: *the arithmetic is correct; the checks guarding it were
not.*

---

## 3 · UNOBSERVED — not passes

A skipped assertion is not a pass. This project has shipped five checks that passed over zero
rows; the list below is the honest remainder.

| what | why | where |
|---|---|---|
| **no tap, on any device** | `adb devices` empty all session. Every Android claim here is about bytes and logic | D1, `TASK-202` |
| **the grey pin at 390px** | 4 SKIPs. The map is collapsed on a phone by design; the Objektliste IS the surface and IS asserted | §1.1 |
| **13 of 23 overlay focus traps** | named ceilings in the census, printed on every run, not silence. `/clients/` `/contracts/` `/inventory/` `/material-requests/` `/analytics/` + 2 `/locations/` confirms | `TASK-207` |
| **`ROUND()` at rates other than 1500 c/h** | the floor elsewhere in the collective agreement's range is arithmetic, not measurement | `TASK-204` |
| **`check-field-wire` / `check-prod-restore` with no dump** | both SKIP, exit 0. Correct — but every wire assertion is then silent, and there is no dump on this laptop by design | §5 |
| **`ops/deploy.sh`** | read, never run | D6 |
| **`audit-contrast` mutation** | its numbers are reported as read; its own mutation recipe (lighten `--text-muted`) was not executed this round | — |
| **`pm get-app-links`** | must report `timesheets.exe.xyz: verified`; unprovable off-device | `verify.sh` says so itself |
| **Postgres `numeric` vs JS integer-ms at exact half-cent ties** | the two implementations agree on this fixture and are identical for whole-second shifts; a tie-breaking difference is not excluded by anything run | — |
| **the TagLink corpus** | does not exist. Two hand-written lists (Kotlin's 14 ⊃ Swift's 8) and a comment | `TASK-208` |
| **iOS** | out of scope by brief. `tag-link-check.swift` and the entitlement still name the RENAMEABLE host as the tag host | `TASK-188`, `TASK-208` |

---

## 4 · Decisions 41–44 — stated, not resolved. The owner's call.

```
decision-37  accepted   Zones are places under a building; a shift stays building-level
decision-41  proposed   A worker's rate is REQUIRED and strictly positive
decision-42  proposed   Revenue is a typed, append-only monthly fact per building
decision-43  proposed   Zones carry an area; the building's area is derived   ← SUPERSEDES 37
decision-44  proposed   A tag serial is data on a zone, delivered through the roster
```

**decision-43 supersedes decision-37, which is `accepted`.** Two accepted records therefore
cannot both stand: 37 explicitly *rejected* `square_metres`, and 43 adds `area_sqm NUMERIC(8,2)`
as the reason zones exist at all. 43 also rewrites 37's *"a building with no zones is inactive"*,
which — read naively at the moment 006 lands — would kill the HOIV card that was just
resurrected. **Not resolved here, per brief.** `ZONES-MODEL §12.1` is the eight-question form.

Code that is downstream of a `proposed` record, so the owner can see the size of the word:

```
decision-41  server/lib/validate.js · routes/admin.js · lib/reporting.js
             migrations/006 · web/app/{workers,payroll,pl}/page.tsx · WorkerPanel.tsx
             web/lib/api.ts · web/scripts/check.mjs   + 8 checks
decision-42  server/lib/reporting.js · routes/admin.js · migrations/006
             web/app/pl/page.tsx · web/lib/pl.ts · web/lib/api.ts   + 6 checks
decision-43  migrations/006 · server/routes/{app,admin}.js · lib/reporting.js
             web/lib/{area,objects,filters,pl}.ts · components/{HomeMap,Objektliste,
             BuildingFacts}.tsx · web/app/{locations,pl}/page.tsx
             android core/{Wire,Zones}.kt · data/ShiftStore.kt · ui/TimeSheetViewModel.kt
decision-44  android nfc/{KnownTags,ScanActivity}.kt · net/Api.kt · data/ShiftSync.kt
             server/routes/{app,admin}.js · migrations/006 · web/lib/api.ts
decision-37  android nfc/KnownTags.kt · ui/TimeSheetViewModel.kt · checks/core-check.kt
             migrations/006     ← the four files that would have to choose
```

One concrete cross-dependency the surface probe found and nobody had written down:
**decision-44's edit silently breaks decision-43 §3 on the map.** `HomeMap.tsx` caps a pin at two
chips and pushes the zone chip last, while the grey comes from `data-zone="unzoned"`
unconditionally — so a building earning both earlier chips would be grey with **no word**. It
cannot happen today only because `lib/objects.ts` defines `noTag: here.length === 0` and counts
`unresolved` among `here`, making the two earlier chips mutually exclusive. The day `noTag` means
*"no zone carries a serial"* they become independent. The invariant is now asserted at the
derivation, in `web/scripts/check.mjs`, where that edit has to walk past it.

---

## 5 · Unverifiable on this machine, by design

- **No Android device.** No tap, no NFC, no App Link verification. Emulators cannot read a tag.
- **A referrer-restricted Maps key.** It works on exactly `http://127.0.0.1:8080/*` and on no
  other loopback origin, and it is **not** authorised for the API host. So the production map
  cannot be proven from here at all — only its absence can, and it is (D2).
- **Production untouched by design.** `curl` only. Every database measurement in this file is
  against `nfc_demo` or a scratch copy on this laptop. The 006-against-real-data evidence is the
  data probe's, from a dump that has since been wiped (§7).
- **No production dump on disk**, so `check-field-wire.mjs` and `check-prod-restore.mjs` SKIP.
  Taking one is a read-only `pg_dump`, and it is the first step of the deploy runbook.
- **iOS.** Not built, not run, not modified.

---

## 6 · The suite, re-run at 8702615

Keyed bundle, API on `:8080` against `nfc_demo`, README order respected.

| check | result |
|---|---|
| `sh demo/check-guards.sh` | OK — 16 refusals, 64 files parse |
| `node server/check-api.js` | PASS |
| `node server/db/check-migrate.js` | OK — names 006's refusal branch explicitly |
| `node server/routes/wellknown.test.js` | OK |
| `node server/check-close-flag.mjs` | 7 pass, 0 fail — **and see D5 #7: it proves nothing** |
| `cd web && pnpm check` | All checks passed — 1173 keys, exact de/en parity, 132 plural nodes |
| `cd web && pnpm verify` | exit 0 — 15 static routes |
| `BASE=…:8080 probe-zones-revenue.mjs` | all geometry probes passed, 4 SKIP (390 map only) |
| `check-revenue-unknown.mjs` | OK — 117 amounts across 12 routes, **0 new zeros**, teardown clean |
| `DEMO_BASE=…:8080 check-money.mjs` | all green — screen `3.874,51 €` = 387451 c = SQL oracle, rounded once per worker, **behind a non-vacuity gate** (per-worker vs per-shift differ by 26 c on this fixture) |
| `DEMO_BASE=…:8080 check-reports.mjs` | all checks green — CSV `payroll-2026-07-01.csv`, BOM, `;`, total 387451 = screen |
| `DEMO_BASE=…:8080 check-filters.mjs` | PASS — in a **keyed** build (that was TASK-186) |
| `node demo/check-map-home.mjs` | PASS |
| `node demo/check-map-key.mjs` | **FAIL** — D2. The only red in the suite, and it is a fact about Google, not about this tree |
| `DEMO_BASE=…:8080 check-ia-greyscale.mjs` | PASS — incl. the grey unzoned pin and its word |
| `AUDIT_BASE=…:8080 audit-contrast.mjs` | 0 unexpected failures, 4 accepted |
| `AUDIT_BASE=…:8080 audit-widths.mjs` | **420/420**, 11 widths × 19 states × 2 themes, worst +0px; sabotage self-test detected and named |
| `AUDIT_BASE=…:8080 audit-overlays.mjs` | 88/88, census 10/23 audited + 13 named ceilings |
| `AUDIT_BASE=…:8080 audit-overlays2.mjs` | 25/25 |
| `AUDIT_BASE=…:8080 audit-keyboard.mjs` | 14/14 |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY=… sh demo/fix-mutants.sh t176` | every negative case fires |
| `cd android && ./checks/run.sh` | core-check OK (311) · known-tags-check OK (27) |
| `node ops/check-branding.mjs` | OK (14) — with the standing iOS TODO, correctly |
| `sh server/wellknown/verify.sh` | VERIFY OK — safe to write NFC tags |
| `gitleaks detect` | 128 commits, no leaks |
| `check-field-wire.mjs` / `check-prod-restore.mjs` | **SKIP** — no dump on this laptop (§3) |

Constraints from the brief, checked rather than assumed: money is integer cents and the only
division is `numeric` in SQL, rounded once (`reporting.js:328`); no float multiply on a money
total (`payroll.ts:118` is `int × int / 3_600_000`, max ~1.4e12, far under 2^53); per-m² is a
derived display ratio, rounded then Intl-rounded — 46408 c over 980 m² → 47.36 c/m² → `0,47 €`,
re-derived by hand; Vienna DST is pinned in `check-api` (*"23:30 on 31 October is October"*);
390px is 1 of the 11 widths in `audit-widths`, +0px; `output: 'export'` unchanged; **no new npm
dependency** — `pnpm-lock.yaml` and every `package.json` are byte-identical to `f6f7448`, server
deps are still `pg` + `@sentry/node`.

---

## 7 · The board now matches the tree

`TASK-190 191 193 194 195 196 197 198 199 200` → **Done**, each with the named passing check in
its notes. `TASK-185 186 187` → **Done**: all three were checks reported red, and all three are
green in a keyed build. `TASK-156 157 158 159` → **Done as duplicates**, explicitly not as work
this run did, each pointing at the task that shipped — and each had *"(PROPOSED — do not build)"*
about the ACCEPTED decision-37 in its body, which is how an executor rebuilds what exists.

Two are **In Progress with the remainder written into the body**, because partial is not Done:

- **`TASK-192`** — AC#4 is FALSE and I measured it (D4). Everything else in it is verified.
- **`TASK-201`** — the zone logic and the signed versionCode-4 APK are real; `KnownTags.kt` is
  still present, correctly, because decision-44 deletes it only after a zone carries the serial
  and no zone exists in production. AC#1's gate has not fired.

Filed: **`TASK-206`** maps key (two steps, one outside this repo) · **`TASK-207`** the 13
unmeasured overlay traps · **`TASK-208`** the TagLink corpus that does not exist ·
**`TASK-209`** six dead default ports · **`TASK-210`** worktrees for overlapping runs.
Already filed and confirmed still open: `TASK-202` `TASK-203` `TASK-204` `TASK-205` `TASK-181`
`TASK-180` `TASK-188`.

---

## 8 · What did NOT happen, and cleanup

- **Nothing was deployed.** Production is on `schema_migrations = 5`, has no `zones` table, and
  its live bundle contains none of `Zonen verwalten` / `Nicht eingetragen` / `Noch keine Zone` /
  `je m²` — measured across all 13 chunks this session.
- **No migration was applied anywhere but a throwaway local database.**
- **No application code was changed by this run.** Board, this document, and five task bodies.
- **No APK built or installed. No tag written. No iOS file modified.**
- **`git add -A` was never used**; every commit stages explicit paths.
- Scratch database `vfinal_scratch` created, measured (D4), and **dropped**; its server killed;
  its cookie jar removed. `psql -Atc "… like 'vfinal%'"` → empty.
- `nfc_demo` reseeded after the two writing audits: 2 unresolved auto-closed shifts back, 16/16
  tables at their pre-run counts. `check-money`'s own teardown asserts it independently.
- Four orphan headless Chromes on `:9341` from an earlier run were killed — they were the cause
  of `Promise was collected` (D8). The orphan `node server/server.js` on `:8080` was **reused**,
  not killed: `assertFreshServer` positively established it is this tree's code, booted after the
  newest file under `server/`. `web/out` is a keyless bundle right now, because `pnpm verify` ran
  last — deliberately, to demonstrate D5's guard. Rebuild with the key before any browser check.
- Left behind on purpose, because they are not this run's: the local role `nfc` (a documented
  prerequisite, no data) and the scratch database `portal_smoke_69166`. Somebody should drop the
  second one.
