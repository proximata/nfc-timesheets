# Backlog triage 2 — what is genuinely useful, what to delete

Written 2026-08-19 against HEAD `5661d49`. **Nothing was deleted.** This document is the
proposal; §3 is the list to approve in one word.

Board today: **106 tasks — 48 Done · 8 In Progress · 50 To Do**, i.e. **58 open**.
Proposal: **24 DELETE · 4 MERGE away · 30 survive.** Open board 58 → 30.

Every verdict below was checked against the code at HEAD or against production, not against
the task's own notes. Where a task's premise turned out to be still true, it says so; where
the premise died, it names the evidence.

---

## 1 · The four findings that changed verdicts

**F1 — the redesign shipped and the board never noticed.** TASK-140…153 are all `To Do`.
All thirteen screens carry `PageHeader`, the write forms are in `<Drawer>`, `web/messages/_fragments/`
no longer exists (so the merge task ran), and `REDESIGN-REPORT.md` + `REDESIGN-REVIEW.md`
film and re-measure it at `b5c30fd` + `3211e32`. `IA-PLAN.md §9` already writes this down:
*"TASK-140–154 … are still To Do in the tracker although the redesign landed and was reviewed."*
14 tasks delete on this ground alone.

**F2 — production runs a KEYLESS build. The map does not exist for the owner.** Measured
live, not read from a note:

```
curl https://schimmer-glanz.exe.xyz/  → 200, 13 chunks downloaded
grep AIza sgjs/*   → nothing            grep noKey sgjs/*  → present
ops/deploy.sh:49   (cd web && … NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm verify)   ← no maps key
```

The map is the landing surface (decision-39, TASK-155 Done) and it has never drawn a pin on
the machine the owner opens. One line in `ops/deploy.sh`. This is the whole reason TASK-16
survives instead of being deleted as "superseded by 155".

**F3 — TASK-170 is Done with none of its acceptance criteria ticked.** The building IS
pinned in production (48.1761151/16.3953038 ✓ AC2), but AC4 — *"ops/deploy.sh runs it"* — is
not true: `grep -n backfill ops/deploy.sh` → nothing. The residue belongs with TASK-169, the
other deploy.sh gap.

**F4 — the highest-ranked journey in the product has no task.** `JOURNEYS.md §8` ranks W5
*clock out* #1: INCIDENT 1 reproduces **on every shift at the only live building** until a
build reaches that phone. The fix exists (`TimeSheetApp.kt:676`, Scan on the running screen),
plus the tag-host split and `KnownTags`. Nothing on the board says *put this APK on Bálint's
phone*. See §7.

---

## 2 · Verdicts, all 58 open tasks

Reason column: **code** = verified in the tree at HEAD · **live** = verified against
production · **doc** = a decision or design doc settles it.

### 2.1 Already true — DELETE (18)

| id | title | verdict | reason |
|---|---|---|---|
| 140 | Redesign / dashboard | DELETE | shipped `b5c30fd`. `AnswerBand`×3, `PageHeader`, drawer on `/` — code. Then superseded again by 155/162 (Done) |
| 141 | Redesign /shifts/ | DELETE | shipped. 4 `<Drawer>` in `shifts/page.tsx`; REDESIGN-REPORT truth #3 filmed |
| 142 | Redesign /workers/ | DELETE | shipped. drawer + inline one-shot code panel (report truth #2) |
| 143 | Redesign /locations/ | DELETE | shipped. drawer + verbatim tag URI, clipboard read back (truth #5) |
| 144 | Redesign /clients/ | DELETE | shipped. 2 drawers — code |
| 145 | Redesign /contracts/ | DELETE | shipped. drawer + four-item callout — code |
| 146 | Redesign /inventory/ | DELETE | shipped. drawer — code |
| 147 | Redesign /material-requests/ | DELETE | shipped. drawer, lifecycle buttons still on the row — code |
| 148 | Redesign /payroll/ | DELETE | shipped, no drawer (correct). Residue = TASK-185 (caveats behind a closed `<details>`) |
| 149 | Redesign /pl/ | DELETE | shipped. AnswerBand + baseline drawer — code |
| 150 | Redesign /analytics/ | DELETE | shipped. table primary, map optional — code |
| 151 | Redesign /account/ | DELETE | shipped. `PageHeader` + `question`; no reset control, comment states why |
| 152 | Redesign /login/ | DELETE | shipped. `type="text" autoComplete="username"`, ONE failure message (`kind === 'failed'`) |
| 153 | Redesign merge | DELETE | shipped. `_fragments/` gone, de/en merged, `pnpm verify` green in REDESIGN-REVIEW §1 |
| 50 | Admin panel on a phone | DELETE | shipped. decision-28 accepted + supersedes decision-7; `DesktopOnlyGuard.tsx` deleted (only README mentions it); ≤767px card transform; TASK-166/179 Done |
| 51 | Required vs optional fields | DELETE | shipped. `components/Field.tsx` has `required`/`optional` + describedby wiring; used across workers/locations/inventory. The payroll trap it warned about is closed by TASK-176 (Done): a rate-less worker is a NAMED exclusion, never a silent 0,00 € |
| 163 | Objektpanel `/?location=<uuid>` | DELETE | shipped. `components/BuildingPanel.tsx` + `page.tsx:125` resolves `?location=`. Status is stale, not open work |
| 164 | Mitarbeiterpanel `/workers/?worker=<id>` | DELETE | shipped. `components/WorkerPanel.tsx` + `workers/page.tsx:132`. TASK-177 (Done) already fixed its defects |

### 2.2 Superseded, duplicate or answered — DELETE (6)

| id | title | verdict | reason |
|---|---|---|---|
| 48 | Vienna map on the admin dashboard | DELETE | duplicate of 16 under a second name, and superseded by TASK-155 (Done, decision-39: the map IS the landing surface). Its one live truth — the deploy build has no key — is carried by 16 |
| 26 | APNs prerequisites documentation | DELETE | documentation for a capability nothing needs. Both out-of-app signals work without push (iOS badge, Android ongoing notification); the 8 h warning is a LOCAL notification. `research/android-path.md §6` holds the equivalent FCM ground. Re-file the day the office wants to poke a phone |
| 47 | Feedback screen | DELETE | speculative, and its trigger is already answered elsewhere: the concrete case (could not clock out) is fixed in the tree, and "why is this row different" is TASK-46. Building it costs two apps + server + an admin queue for a channel that is a phone call at one building. Not asked twice |
| 49 | Analyse Bálint's screen recording | DELETE | research whose answer is known. Its one actionable finding is written up in `JOURNEYS.md` W5 (INCIDENT 1) and fixed at `TimeSheetApp.kt:676`. A fresh field observation with the NEXT build is worth more than forensics on an 8-day-old file. The recording stays in Telegram; nothing is destroyed by closing the task |
| 53 | RESEARCH Pear/Holepunch + Keet | DELETE | a subset of 52's iOS half, one level deeper, and nobody asked twice. Nothing on the roadmap waits on it |
| 52 | RESEARCH store-independent delivery | DELETE | the operative answers are already known and written: Android sideloads today (that is how the field phone got its APK), iOS is TestFlight, guideline 2.5.2 bans the rest. The real pain — release latency — is a delivery task (§7), not a research document |



### 2.3 Fold into another task — MERGE (4)

| id | title | verdict | reason |
|---|---|---|---|
| 22 | Payroll summary view | MERGE → 20 | only AC5 is open and it is literally unimplementable until `worker_rates` exists. The screen is done and filmed. It closes when 20 closes |
| 17 | Google Street View photos | MERGE → 44 | zero code. One checkbox in the owner's Google Cloud console ("Street View Static API"), same class as the unset `SENTRY_DSN` and the unbuilt maps key: **secrets obtained, never installed**. Make 44 the one "install the things we already paid for" task |
| 18 | Shifts table filters + pagination | MERGE → 161 | AC2 (URL-persisted filters) shipped as TASK-160 + decision-38. AC5 (sort by any column) nobody asked for twice. AC3 (pagination) must NOT be solved by bounding the fetch — TASK-141 records why (`outsideCount`, `emptyOutside`: the difference between "nothing in August" and "our payroll data is gone"). The honest fix is server-side aggregates = TASK-161 |
| 41 | Cut the TestFlight build | MERGE → 188 | one iOS release, not two tasks. 188 is the code + entitlement change (decision-40) and 41 is the archive/upload checklist; shipping one without the other either wastes a release or ships a build whose universal links die on the next VM rename. Keep 41's 6-point checklist verbatim inside 188. Gated by 40 (German plurals) |

### 2.4 Survives — KEEP (30)

| id | title | verdict | reason |
|---|---|---|---|
| 16 | Vienna map view + pins | **KEEP, rescoped** | **live**: the deployed bundle has no `AIza…` and does contain `noKey`. `ops/deploy.sh:49` builds without `NEXT_PUBLIC_GOOGLE_MAPS_KEY`. One line. Rescope the title to "the deploy build ships without the maps key" and absorb 48 |
| 20 | Workers CRUD + rate history | **KEEP** | `worker_rates` does not exist; every past month is priced at TODAY's rate. Money correctness — protected, never deletable on age. decision-28(proposed) is the deferral record, not a closure |
| 30 | Cryptographic proof-of-presence | KEEP (deferred) | **the rule saved this one.** Aged, unscheduled, precondition unmet — but it is a trust boundary (tag replay from home, decision-15 leaves tags unlocked). Do not delete; convert to a decision record "we accept tag replay at this scale" if it must leave the board |
| 37 | Purge client name from git history | **KEEP** | **the rule saved this one.** Privacy, public repo, still fetchable: `git show 33e66b2:docs/media/app-shift.png`. Owner-decision (force push), not agent work |
| 38 | Offsite pg_dump destination | **KEEP** | **the rule saved this one.** Data loss: dumps share `/dev/root` with the database. `JOURNEYS.md §8` row 16: probability low, loss total. ~3 lines of rclone; the example is already in the script |
| 39 | Decide CORS policy explicitly | KEEP (small) | **the rule saved this one.** Nothing is exploitable today (no ACAO + `SameSite=Strict`, both probed), but it is a trust boundary held up by three unasserted guarantees. One constant + one assertion in `check-api.js`. No cors package |
| 40 | German plurals '4 alte Schichts' | KEEP | user-visible broken German on the trust screen, in the DEFAULT language (decision-8). Blocks the iOS release (188) |
| 42 | Prove Android on physical NFC | **KEEP, rescoped** | half of it happened for real on 2026-08-11 (shift 7, HOIV — first Android clock-in ever), so AC1–4 are field-proven on an ADOPTED serial tag. What is still unproven is the part the revived tag host unlocks: a **passive tap on a URL tag** on Android, plus behaviour with NFC switched off. `JOURNEYS.md §8` ranks W3 clock-in #2 |
| 43 | Play Console prerequisites | KEEP | the privacy policy page is real engineering and real law: `/privacy`, `/datenschutz`, `/privacy-policy` all 404, and the data is employment + location data about identified Austrians. Agent writes the page; owner answers the two declarations |
| 44 | Sentry DSN unset in production | **KEEP** | a failed clock-in is currently invisible. `/etc/nfc/env` holds APP_KEY, DATABASE_URL, PORT only. One env var. Absorbs 17 |
| 45 | Enrolment code lifetime (IP) | KEEP (shrink) | default is 5 days and deployed ✓. Residue is one line of UI — the absolute deadline shown AT COPY TIME — and it matters the week a new client's cleaners get enrolled |
| 46 | Admin note on a shift correction | **KEEP** | INCIDENT 3. `grep correction_note server/` → 0. Every hand-closed shift looks like every other hand edit; D5 happens ≥1×/week. Money edit without a reason |
| 154 | Redesign cleanup: kill legacy rules | KEEP (shrink) | NOT shipped: `.worker-form` (globals.css:605), `.button-primary`/`.button-secondary` still used by `reinigung/page.tsx:146` and `LogoutButton.tsx`. Small, and it stops the tree carrying two design systems |
| 156 | Zones migration 006 | KEEP | decision-37 is **accepted** (the tasks still say PROPOSED — stale). The empty database is the cheapest moment. This is also where an URL-less serial tag gets a home in the DATA MODEL instead of `KnownTags.kt` |
| 157 | Zones: server resolves a tapped PLACE | KEEP | the wire-compat constraints (422 `unknown_location` unchanged, `location_uuid` field name kept) are what let it ship without bricking the phone in the field |
| 158 | Zones in the admin + adopt by serial | KEEP | adoption by typing a serial removes a release from the loop — the cheap half of D2 |
| 159 | Zones on Android: compare BUILDINGS | KEEP (hard gate) | without it a second tag in one building is INCIDENT 7 at scale: `auto_closed=true` + unpaid, unresolved shifts. **Nothing physical goes on a second wall until this is on every phone** |
| 161 | GET /admin/overview | KEEP | browser arithmetic over a payload capped at `SHIFT_PAGE_MAX=2000` silently under-reports; the home screen fetches up to 2000 shift rows to compute four counts. Absorbs 18 |
| 167 | Zone block + tag truth in the Objektpanel | KEEP | gives "which walls have tags" a home instead of a human's memory. Depends on 156–158 |
| 168 | Objekt einrichten: one thread, four steps | **KEEP** | D1, and **it starts next week**. Today: four screens plus the director's memory, and steps 5/6/8/9 are marked broken in JOURNEYS |
| 169 | deploy.sh must remove stale test material | **KEEP** | `db/check-migrate.js` is still on the box beside the payroll database; `check-api.js` CREATEs and DROPs schemas against `DATABASE_URL`. Also inherit TASK-170's unmet AC4 (wire the geocode backfill into the deploy) — same file, same class |
| 180 | Answer bands print 0 for "nothing to measure" | KEEP | four screens read as an all-clear over zero rows. One component signature, four call sites |
| 181 | Raw server tokens in the UI (`no_key`) | KEEP (low) | premise partly aged: the one production building now has coordinates. The mapping is still right for every building created next week and for `REQUEST_DENIED`/`OVER_QUERY_LIMIT`. Keep the raw token in parentheses |
| 182 | Client portal wraps on a phone | **KEEP** | the ONLY screen an outsider sees, delivered by WhatsApp, opened on a phone — and a new client arrives next week. Also: the card does not name the operator |
| 183 | Same shift twice + a paragraph in a cell | KEEP (low) | the target of the dashboard's most-used link shows one shift twice under two cells that both read 1 |
| 184 | Clip contract accrual to today | **KEEP** | money: a running period books whole-period revenue against partial cost — "Dieses Jahr 71,33 %" with 135 days that have not happened. Needs a decision record first. Protected |
| 185 | check-reports.mjs red since the disclosure shipped | KEEP | two payroll caveats are in the DOM and not on screen, and the suite has been exiting non-zero long enough that red reads as normal. Includes the rate-history sentence — the one that matters in a wage dispute |
| 186 | check-filters.mjs green only in a keyless build | KEEP | a check whose negative case cannot fail is not a check: every assertion after line 133 has never run in a keyed build |
| 187 | Map info box clips 4px at 1680×1050 | KEEP (low) | silent fold, no scrollbar, same mechanism as defect V1. Ranks BELOW 16 — in production this box never renders at all today |
| 188 | Move iOS onto the permanent tag host | **KEEP** | without it the next VM rename kills iOS universal links exactly as it killed the HOIV card. Absorbs 41 |

---

## 3 · The deletion list — approve with one word

Delete these 24 task files. Nothing here is money correctness, a trust boundary, data loss,
accessibility, or a physical site visit.

```
shipped, board never caught up
  140 141 142 143 144 145 146 147 148 149 150 151 152 153   (the redesign)
  50 51                                                     (phone admin, required fields)
  163 164                                                   (Objektpanel, Mitarbeiterpanel)

superseded / duplicate
  48                                                        (dup of 16, superseded by 155)

answered, or never asked twice
  26 47 49 52 53
```

Then fold, keeping the text: **22 → 20 · 17 → 44 · 18 → 161 · 41 → 188.**

Result: 58 open → **30**.

---

## 4 · Survivors, grouped by what they serve

**Onboarding the first client (next week)** — 168 · 158 · 156 · 157 · 182 · 45 · 181
> The thread that creates client → building → contract → tag → portal link without leaving
> the drawer, the data model that lets a wall carry a tag, and the one screen the client sees.

**A worker's day** — 42 · 159 · 46 · 30(deferred)
> Whether a tap works at 06:00 at a door, whether a second tag is safe, and whether the
> repair that follows a failure leaves a reason behind.

**The director's month** — 20(+22) · 184 · 185 · 161 · 180 · 183
> All money: what a raise does to March, what a running period does to a margin, and which
> caveats are actually on the screen where money becomes a bank transfer.

**Getting the app onto phones** — 188(+41) · 40 · 43
> One iOS release carrying the permanent-tag-host change and correct German. Android's
> equivalent is missing from the board entirely — §7.

**Keeping it alive** — 16 · 44(+17) · 38 · 169 · 37 · 39 · 186 · 187 · 154
> The deploy that does not install what we already bought, the telemetry that reports
> nothing, the backup next to the thing it backs up, the test material next to the payroll
> database, and two checks that cannot currently fail.

---

## 5 · The five that would most change the owner's week

1. **16 — one line in `ops/deploy.sh`.** The map is the landing surface and it has never
   drawn in production, because the build is keyless. Measured, not assumed. Lowest
   effort:value ratio on the board.
2. **168 — Objekt einrichten as one thread.** The client onboards next week; today it is
   four screens and memory, and the tag URI and portal link live on two of them.
3. **46 — a reason on a corrected shift.** He hand-closes a shift about once a week already,
   and the record cannot say why. Effort low, blast radius small, one nullable column.
4. **44 — the Sentry DSN.** A failed clock-in is currently silent and turns up weeks later
   as an argument about pay. One env var.
5. **42 (rescoped) — a passive tap on the revived tag host.** The appeal of the product is
   absent at 100% of live sites while the only tag is an adopted serial one. The host is
   back; nobody has held a phone to a URL tag on Android yet.

Just behind: **38** (offsite backup) and **20** (`worker_rates`). Both change the month
rather than the week, and both are the kind of thing that is cheap now and expensive later.

## 6 · The five oldest nobody has missed

All created 2026-07-28 or 2026-08-04 and untouched since.

| id | age | why nobody missed it |
|---|---|---|
| 26 | 07-28 | APNs how-to for push nothing needs. **DELETE** |
| 17 | 07-28 | Street View photos: decoration at one building, and blocked on a checkbox. **MERGE → 44** |
| 18 | 07-28 | shifts pagination and sorting: 5 rows in production. **MERGE → 161** |
| 30 | 07-28 | tag crypto for a threat that has not occurred once. **KEEP — the rule saved it** |
| 39 | 08-04 | CORS policy that is already correct by accident. **KEEP — the rule saved it** |

## 7 · What the protection rule saved

Five tasks would have gone on age or on "nothing is broken today", and did not:

- **30** — trust boundary (a tag value can be replayed from a sofa).
- **37** — privacy, and a public repo where deletion is not removal.
- **38** — total data loss of payroll history; the backup shares the disk.
- **39** — trust boundary held up by three guarantees, only one of which is asserted.
- **184 / 20** — money correctness. Neither is "old and quiet"; both are arithmetic that a
  person will one day argue with.

## 8 · Missing from the board

**No task says: put the current Android build on the phone in the field.** It is the
top-ranked journey in `JOURNEYS.md §8` and it is a multiplier on every worker-side fix:

```
INCIDENT 1 fix   TimeSheetApp.kt:676  Scan on the running screen   ✓ in tree, ✗ on the phone
tag-host split   BuildConfig.API_HOST                              ✓ in tree, ✗ on the phone
KnownTags HOIV   nfc/KnownTags.kt                                  ✓ in tree, ✗ on the phone
```

Until it ships, a worker at the only live building has **no reachable way to clock out**, and
that repeats every shift. Installing OVER the existing app keeps the session
(`allowBackup="false"`, session in SharedPreferences); uninstalling first wipes it and needs a
new enrolment code. File it before doing anything else on this list.

Also filed by this run: **an Android cleaner cannot see their own hours** — `GET /shifts/mine`
exists (`server/routes/app.js:475`) and only `NFCTimeSheets/API.swift:501` calls it. A pay
dispute has no worker-side source of truth on Android.

## 9 · Bookkeeping defects found while triaging

- **TASK-170 is Done with 0/4 acceptance criteria ticked.** AC2 is true in production; AC4 is
  false (`ops/deploy.sh` never runs the backfill). Residue → 169.
- **163 and 164 are In Progress but shipped.** So are 16/17/18/20/22, which have been In
  Progress since 2026-08-04 and are really "partly shipped, remainder named".
- **Two decision records both claim `id: decision-28`** — the proposed contract-history one
  and the accepted admin-on-a-phone one. Whichever loses, a task's citation of "decision-28"
  is currently ambiguous.
- **decision-37 is accepted**, but TASK-156/157/158/159/167 all still say "(PROPOSED — do not
  build until the owner accepts it)". Update the line or an executor will stop at it.
- **There is no `Deferred` status** (`backlog/config.yml` has three), which is why TASK-30
  carries "DO NOT PICK THIS UP" in prose.

## 10 · What did NOT happen

- Nothing was deleted, merged, closed or re-statused. This document proposes; §3 is the
  approval surface.
- Production was read-only: one `curl` of the public admin bundle and its JS chunks. No
  database, no SSH, no write.
- iOS was not touched. Zone design was not re-litigated. No task body was edited.
