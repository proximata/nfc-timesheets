# Admin panel audit — what the screens actually do with the live data

Audit only. No product code written. Date of record: **2026-08-03**, Europe/Vienna.

Live data used throughout: 1 worker (Demo Worker), 1 building (HOIV), 1 client, 1 contact,
0 inventory, 1 live portal link, 5 shifts — **all on 2026-07-30**, all closed, none auto-closed,
none corrected. Server `hours` aggregate: worker 1 → `hours 0.341`, `pay_cents 5118`.

## Runnable check behind every claim below

The period arithmetic was not read, it was executed. The real `web/lib/shifts.ts` and
`web/lib/payroll.ts` were run under Node against the five real shifts with the clock at
2026-08-03:

```
TZ=Europe/Vienna node --experimental-strip-types run.ts
shifts page period=week     from=2026-08-02T22:00Z visible=0/5
shifts page period=month    from=2026-07-31T22:00Z visible=0/5   <-- the default
shifts page period=quarter  from=2026-06-30T22:00Z visible=5/5
shifts page period=year     from=2025-12-31T23:00Z visible=5/5
shifts page period=all      from=-                 visible=5/5
payroll period=thisMonth    [2026-07-31T22:00Z, 2026-08-31T22:00Z) lines=0
payroll period=lastMonth    [2026-06-30T22:00Z, 2026-07-31T22:00Z) lines=1   <-- the default
locations HOIV this month: minutes=0 pending=0 -> "0:00"
```

Both defaults are wrong in opposite directions on the same day. That is the whole report.

---

# Part A — screen by screen, today

## `/` Dashboard — `web/app/page.tsx`

**Renders today.** `problemCount = 0`. Summary line: *"Nichts zu tun. Zurzeit ist niemand
eingestempelt."* "Gerade im Einsatz": *"Zurzeit ist niemand eingestempelt."* "Zu erledigen": three
green lines — no unresolved shift, every active worker has a login address (assuming Ivan's email
is set; if it is null this line names him), every active building has a shift on record. HOIV IS in
`seenLocationIds` because the dashboard scans **all** loaded shifts with no period filter
(`page.tsx:104-110`), so no dead-tag warning. No truncation note.

**Verdict:** the dashboard is the one screen that is telling the truth today. Nothing is broken, so
it shows nothing. The director read "nothing" as "my data is gone" because the two neighbouring
screens genuinely were hiding it.

**Filters that hide data.** None. No period, no limit control, no active toggle. Only implicit
bound: `/admin/data?limit=2000`. The dead-tag line degrades when that cap is hit and says so
(`page.tsx:236-238`).

**Can it disagree with another screen?** Yes, on **time zone**. `clockTime` (`page.tsx:114-118`)
and `asOf` (`page.tsx:179`) call `format.dateTime` with **no `timeZone`** → the browser's zone. The
shift log pins `Europe/Vienna` explicitly (`shifts/page.tsx:326-332`). A director on a laptop set
to UTC sees a clock-in at 13:57 here and 15:57 on `/shifts/`. See D9.

**Dead ends.** None. Refresh button, every triage line links to its fix screen.

**A11y / German.** Clean. Text-not-colour throughout, permanent live regions, `formatDuration`
labelled as `Std.`. No plural bug in this namespace.

## `/login/` — `web/app/login/page.tsx`

**Renders today.** Two fields, one button. One uniform failure message for unknown-email and
wrong-password (`login/page.tsx:41-50`) — correct, no account oracle. No chrome
(`AppShell.tsx:22-30`).

**Hiding data / disagreement.** N/A.

**Dead ends.** Two small ones. (a) An already-signed-in admin who navigates to `/login/` gets the
form with no "you are already signed in" and no redirect — signing in again is harmless but the
state is confusing. (b) `router.push('/')` on success, so a session that expired on `/payroll/`
sends the director to the dashboard, not back to payroll. Both are annoyances, not money.

**A11y / German.** `autoFocus` on email is justified (single-purpose page) and biome-ignored.
`aria-describedby`/`aria-invalid` wired to a permanent `role="alert"`. German is correct and formal
(*Sie*). No defect.

## `/workers/` — `web/app/workers/page.tsx`

**Renders today.** One row: Demo Worker, his email or *"Keine E-Mail – keine Anmeldung
möglich"*, phone or *"Keine Nummer hinterlegt"*, rate as `format.number(cents/100, currency EUR)`,
*Aktiv*. Form above it in "anlegen" mode.

**Filters that hide data.** **None at all** — and that is itself notable: the list is unfiltered and
unpaginated, active-first (`admin.js:114`). At 20 workers that is fine. There is no active/inactive
toggle to get stuck in.

**Disagreement.** The rate shown here is the ONLY place the rate is visible, and it is the rate
`/payroll/` multiplies by. `v.cents` accepts anything up to **€1,000,000/hour**
(`server/lib/validate.js:106-110`). The live aggregate implies roughly €150/h for 20 minutes of work
(`pay_cents 5118` against `hours 0.341`). Either that is real or the rate field was typed wrong, and
**no screen questions it**. See D7.

**Dead ends.** "Deaktivieren" is a **single unconfirmed click** that locks a real person out of the
app (`workers/page.tsx:213`). Recoverable — the button flips to "Wieder aktivieren" — but the worker
is locked out in the meantime and the change is invisible from any other screen.

**A11y / German.** Good. `tel:` link strips punctuation. `phoneHint` explicitly says the phone is
NOT the login, which is the right defence for a non-technical director. No defect.

## `/locations/` — `web/app/locations/page.tsx`

**Renders today.** One row, HOIV. Address or *"Keine Adresse hinterlegt"*, client + contact name,
the tag URI `https://timesheets.exe.xyz/t?l=<uuid>` in full with a copy button, the UUID beneath it,
the live portal grant with "Teilen beenden" / "Neuer Link", *Aktiv*.

**The "Vertrag und Zeit in diesem Monat" cell reads `0:00`.** Verified by running the real
`timeThisMonth` (`locations/page.tsx:180-192`) over the real shifts: `minutes=0, pending=0`. If a
Sollzeit is ever entered, the cell will additionally assert *"Das sind 40:00 unter der Sollzeit."*
The building was in fact cleaned four days ago.

**Filters that hide data.** One, hardcoded and with **no control to change it**:
`periodStart('month', new Date())` at `locations/page.tsx:181`. There is no month picker, no "last
month", no reset. Between the 1st of a month and the first tap of that month, **every building on
this screen reads 0:00 and over/under-target against zero**. That is the answer to "are we
overservicing this contract", and for the first days of every month it is wrong by a whole month.
See D4.

**Disagreement.** Directly contradicts `/payroll/` on its default period: payroll (`lastMonth`)
prices 0.341 h of HOIV work; this screen says 0:00 of HOIV work. Same database, same browser, same
second.

**Dead ends.** Two real ones.
- "Deaktivieren" on a building **revokes every live client link** server-side
  (`server/routes/admin.js` `deleteLocation`, and `saveLocation({active:false})` does not, so the
  two deactivation paths are not even equivalent — the button here goes through `saveLocation`,
  which does **not** revoke). Meanwhile deactivating a **contact** on `/clients/` does revoke, and
  reactivating never restores. Nothing warns, nothing confirms. See D6.
- `shareOnce` is honest ("Der Link wird nur dieses eine Mal angezeigt"), but the fresh-link panel is
  cleared by the next share/revoke action with no "are you sure you copied it".

**A11y / German.** `Kurzkürzel` (`de.json:181`) is a pleonasm — *kurz* + *Kürzel*. Austrian business
German would be *Kürzel* or *Kurzname*. Worse: this screen calls a shift an **Einsatz**
(`de.json:238, 252, 256, 227`) while `/shifts/`, `/` and `/payroll/` call the same thing a
**Schicht**. Two words, one concept — the exact rule `AGENTS.md` and decision-8 set. See D13.

## `/clients/` — `web/app/clients/page.tsx`

**Renders today.** One client row (buildings: HOIV; people: the one contact; *Aktiv*) and one
contact row (its client, email/phone or *"Keine …"*, *Aktiv*). Two forms.

**Filters that hide data.** None. Both lists unfiltered.

**Disagreement.** It fetches `/admin/data` with **no `limit`** (`web/lib/api.ts:505`), so the server
returns its 500-shift default plus the full `hours` aggregate — a payload this screen never reads.
Harmless today, wasteful at scale. Not a correctness bug.

**Dead ends.** `toggleContact` (`clients/page.tsx:235`) deactivates via `DELETE`, which **revokes
that person's live portal links**. Reactivating with `saveContact({active:true})` does **not**
restore them. The link the director sent to the client silently dies and neither screen says so. One
unconfirmed click. See D6.

**A11y / German.** `clientError === 'errorNameRequired'` is used both as the form-level alert and
the field-level one, so the same sentence is announced twice (`clients/page.tsx:307, 330`). Minor.
German is correct.

## `/inventory/` — `web/app/inventory/page.tsx`

**Renders today.** Zero rows. Empty state: *"Noch keine Einträge…"* with the form directly above it.
Correct and unambiguous — nothing can be hidden because nothing is filtered.

**Filters that hide data.** None.

**Disagreement.** None; nothing here feeds payroll yet (decision-6 is unimplemented, and the file
says so).

**Dead ends.** None. `unit_cost_cents === 0` renders as *"Kein Preis hinterlegt"* rather than
`€0.00`, which is the right call.

**A11y / German.** Clean.

## `/shifts/` — `web/app/shifts/page.tsx` — **the reported defect**

**Renders today.** `snapshot.shifts.length === 5`. `period` defaults to `'month'`
(`shifts/page.tsx:164`). `periodStart('month', now)` = 2026-08-01 00:00 Vienna
(`lib/shifts.ts:113`). All five shifts start 2026-07-30. `visible.length === 0` — executed, not
guessed.

The screen therefore renders:

- live region: **"0 Schichten angezeigt. Alle zählen zur Bezahlung."** (`shifts/page.tsx:490`)
- table replaced by: **"Keine Schichten für diesen Filter. Einen längeren Zeitraum oder einen
  anderen Mitarbeiter wählen."** (`shifts/page.tsx:763`)

The empty state does name the filter, which is more than most. But **nothing on the screen says
"5 shifts exist, 4 days ago, just outside your selected period"**, and the status line above it
actively reassures ("Alle zählen zur Bezahlung" — vacuously true of an empty set). A director cannot
tell that apart from data loss. He didn't.

**Filters that hide data.** Three, all defaulting to safe values except the period.
- Worker / building default to `all`. Fine.
- Period defaults to `month`. The **vocabulary itself is the bug**: `PERIODS`
  (`lib/shifts.ts:97`) are all *open-ended from now backwards* — "diese Woche", "dieser Monat",
  "dieses Quartal", "dieses Jahr", "alle geladenen". There is **no closed range and no "letzter
  Monat"**. `/payroll/` has the opposite vocabulary — closed `[start, end)` calendar periods
  *including* `lastMonth`, which is its default (`lib/payroll.ts:41`, `payroll/page.tsx:86`). The
  two screens that must agree before money moves cannot even express the same period. See D2.
- Boundary behaviour: on the 1st of any month at 00:01 the shift log goes blank and stays blank
  until the first tap of the new month. Same for `week` every Monday morning — which is exactly when
  the director opens the panel.

**Disagreement.** With `/payroll/` (below), with `/locations/`, and with the database.

**Dead ends.**
- The filter is escapable (`periodAll` exists) but nothing prompts it, and the "Alle geladenen"
  label understates what it does.
- **Clearing the "Ende" field in the correction form silently reopens the shift.**
  `fromBusinessInput('')` → `null`; the empty-string validation branch passes
  (`shifts/page.tsx:277`); `patch.end_time = null` is sent (`shifts/page.tsx:293`). The shift leaves
  payroll AND the worker loses their one open-shift slot, so they cannot clock in anywhere until it
  is fixed. There is a hint (`endHint`) and no confirmation. Worse, `ops/sql/autoclose.sql` will
  then close it at `start + 8h` with `auto_closed = true, corrected_at = NULL` — i.e. one keystroke
  turns a paid, complete July shift into an unresolved 8-hour stub that blocks payroll and blocks
  the worker's phone. See D5.
- `blockedCount` is computed and announced but is **not a filter**. At 2000 rows there is no way to
  jump to the shifts that block payroll — which is this screen's stated primary job.

**A11y / German.** `shifts.resultCount` = `"{count} Schichten angezeigt."` (`de.json:351`) has **no
ICU plural**, so one result reads *"1 Schichten angezeigt."* `scripts/check.mjs` cannot catch this —
it only compares placeholder sets. Everything else on this screen is exemplary: state in words,
origin in words, `role="alert"` regions permanent, focus managed on open/save/cancel.

## `/payroll/` — `web/app/payroll/page.tsx`

**Renders today.** Default period `lastMonth` = **1.–31. Juli 2026**, which **does** contain the
five shifts. So:

- summary: *"1. Juli 2026 bis 31. Juli 2026. – 1 Mitarbeiter, 0,34 Stunden, € 51,18."*
- caveats: *"Keine Schicht in diesem Zeitraum ist offen oder wartet auf Bestätigung"*,
  *"Die hier geladenen Schichten ergeben genau die Gesamtsumme des Servers"* (no truncation at 5
  rows), plus the permanent rate-history caveat.
- one table row: Ivan · 0,34 · €150,00 · €51,18 · *Nichts*.

**So money is on screen — next to a shift log that says the month is empty.** That is precisely the
owner's report, and it is not a perception problem.

**Filters that hide data.**
- `period` defaults to `lastMonth`. Correct default for payroll, wrong relative to `/shifts/`.
- **Switching to "Dieser Monat" today yields `lines.length === 0`** → *"In diesem Zeitraum wurden
  keine Stunden erfasst."* Verified. Good empty state — it names the period and points at the shift
  list.
- The real cap is server-side: `/admin/data` has **no `from`/`to`** and `LIMIT` only the shift rows
  (`server/routes/admin.js:132`), while the `hours` aggregate at line 139-145 has **no start_time
  bound at all**. This page knows it (the file header says so at length) and works around it by
  summing the rows itself and using `hours` only as a cross-check (`payroll/page.tsx:125, 129`).
  That workaround is correct and is the best part of this codebase — but it means payroll's memory
  is exactly 2000 shift rows. At 20 workers that is roughly ten weeks. This is **T4** in
  `backlog/docs/USER-JOURNEYS.md:329`, unshipped.
- `now` is frozen at mount (`payroll/page.tsx:92`). A tab left open across midnight on 31 July
  computes "letzter Monat" as June forever. Minor.

**Disagreement.** Named precisely:
1. **Payroll rows vs shift log rows.** Different period vocabularies (closed calendar vs
   open-ended-from-now) and different defaults (`lastMonth` vs `month`). They can only agree by
   accident.
2. **Payroll rows vs server `hours`.** Surfaced honestly by `reconcile` (`lib/payroll.ts:218`) as
   `caveatReconcile`. Today it reconciles exactly.
3. **Payroll vs `/reinigung/`.** Payroll attributes a shift to the month it **started**
   (`lib/payroll.ts:57-61`, stated on screen as `attributionHint`). The client portal dates a
   cleaning by the day it **ended** in Vienna (`server/routes/portal.js:105`). A shift 31 July
   23:30 → 1 August 00:30 is paid in July and shown to the client as August. See D8.

**Dead ends.** None. Every exclusion is counted, named and linked. CSV export has a BOM, semicolon
separator and integer cents alongside euros. This screen is the model the others should follow.

**A11y / German.** `payroll.summary` (`de.json:84`) has **no plural**: with one hour it reads
*"… 1 Stunden …"*. `{workers}` is safe (*Mitarbeiter* is invariant). Month names go through
`de-AT` deliberately so the director reads *Jänner* (`payroll/page.tsx:70-80`) — correct and rare.

## `/reinigung/` Client portal — `web/app/reinigung/page.tsx`

**Renders today.** Opened with the one live grant's link: heading = *HOIV*, then five rows —
30.07.2026 · *Ivan* · `0:20 Std.` and four rows of `0:00 Std.` (the 15-, 13-, 11- and 9-second test
taps). The four zero-duration rows are the panel's real output today and they look like a
malfunction to the client.

**Filters that hide data.** `RECENT_CLEANINGS = 20` (`server/routes/portal.js:41`) with **no note in
the UI** that the list is capped. A client with a daily contract sees three weeks and no indication
there is more. See D10.

**Disagreement.** With payroll on month attribution (D8). Also: `minutes` is
`EXTRACT(EPOCH…)/60)::int` — truncating, not rounding — so a 59-second cleaning shows as `0:00` and a
89-second one as `0:01`. Small, but it is a number a client compares against an invoice.

**Dead ends.** Handled well: `linkInvalid` has no retry button (retrying a bad token is pointless)
and tells the reader to ask the cleaning company; `tooMany` and `loadFailed` do have one.

**A11y / German.** Correct formal German, `lang="de-AT"` set on `<main>` before JS runs, real table
with `scope`, no admin chrome, exempt from the desktop guard on purpose
(`DesktopOnlyGuard.tsx:25-31`). Only defect is the missing cap notice.

---

# Part B — ranked defect list

Ranked by money hidden or lost. File and line given against the current tree.

| # | Severity | What |
|---|---|---|
| **D1** | **hides money** | Shift log default period hides all existing data with no way to tell that from data loss |
| **D2** | **hides money** | `/shifts/` and `/payroll/` use two different period vocabularies and two different defaults |
| **D3** | **hides money** | `/admin/data` takes no `from`/`to`; `hours` is all-time and unbounded, rows are capped |
| **D4** | **hides money** | Buildings screen is hard-locked to the current calendar month and reads `0:00` today |
| **D5** | **loses money** | Clearing "Ende" in the correction form reopens a shift, unpaid, and locks the worker out |
| **D6** | **loses access** | Deactivating a building or contact irreversibly revokes client links, unconfirmed |
| **D7** | **wrong money** | No plausibility bound on the hourly rate; ~€150/h is live and unchallenged |
| **D8** | disagreement | Payroll dates a shift by start, the client portal by end |
| **D9** | disagreement | Dashboard renders times in the browser zone, the shift log in Europe/Vienna |
| **D10** | hides data | Client portal silently caps at 20 cleanings |
| **D11** | German | `shifts.resultCount` has no ICU plural — *"1 Schichten angezeigt."* |
| **D12** | German | `payroll.summary` has no ICU plural — *"1 Stunden"* |
| **D13** | German | *Einsatz* vs *Schicht* — two words, one concept |
| **D14** | German | *Kurzkürzel* is a pleonasm |
| **D15** | annoyance | Six "Deaktivieren" buttons across four screens, none confirmed |
| **D16** | annoyance | `/clients/` fetches an unbounded `/admin/data` payload it never reads |
| **D17** | annoyance | `/login/` does not redirect an already-signed-in admin; post-login always lands on `/` |
| **D18** | annoyance | Payroll's `now` is frozen at mount |
| **D19** | annoyance | Signed-out 404 renders the full admin shell |
| **D20** | annoyance | Every admin screen fetches 2000 shift rows on a phone behind `display:none` |

## D1 — Shift log default period hides all existing data

`web/app/shifts/page.tsx:164` `useState<Period>('month')`, resolved by `web/lib/shifts.ts:105-121`.
Executed against the live payload: 5 shifts total, **0 visible**.

Two separate faults, both must be fixed:
1. **The default.** `'month'` means "since the 1st", which on the 1st–Nth of a month means "since
   almost nothing". The screen whose job is pre-payroll verification defaults to the one window that
   is empty at the moment payroll is run.
2. **The empty state cannot distinguish "filtered out" from "gone".** `web/app/shifts/page.tsx:763`
   renders `emptyFiltered`, and `:490` renders *"0 Schichten angezeigt. Alle zählen zur
   Bezahlung."* Neither states the count that exists outside the filter. The fix is one sentence
   with a number in it and a control that clears the filter — the data is already in `shifts` in
   memory (`shifts/page.tsx:215`), so `shifts.length - visible.length` costs nothing.

Ponytail ceiling: fixing the default alone is not enough. If the director ever narrows the filter
himself he lands in the same undistinguishable state.

## D2 — Two period vocabularies on the two screens that must agree

`web/lib/shifts.ts:97` `PERIODS = ['week','month','quarter','year','all']` — all open-ended
`[start, now]`, **no `lastMonth`, no explicit range**.
`web/lib/payroll.ts:25` `PAYROLL_PERIODS = ['thisMonth','lastMonth','thisQuarter','thisYear']` —
closed `[start, end)`, defaulting to `lastMonth` (`web/app/payroll/page.tsx:86`).

Consequence today: `/payroll/` shows **€51,18 for July** and `/shifts/` shows **an empty August**,
side by side, both on their defaults. The director is asked to approve a payment he cannot see the
evidence for. That is how somebody gets paid twice or not at all.

The `payroll.ts` file header already documents why the two exist. The documented reason justifies
two *types*; it does not justify the shift log being unable to answer "show me last month", which is
the only question payroll ever asks of it.

## D3 — The server has no date range; the aggregate and the rows describe different time ranges

`server/routes/admin.js:139-145`:

```sql
WHERE s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)
```

No `start_time` bound. All time, forever, and not subject to the `LIMIT $1` at line 132 that caps
the row list. `GET /admin/data` accepts only `limit` (line 106-108).

`/payroll/` already refuses to pay from this number and says so loudly — that mitigation is correct
and must be kept. What remains is that the panel's total memory is `SHIFT_PAGE_MAX = 2000` rows
(`admin.js:26`): roughly ten weeks at 20 workers, roughly eighteen months at today's volume. Beyond
it, `caveatTruncated` and `caveatReconcile` fire and every period total is understated.

This is **T4** (`backlog/docs/USER-JOURNEYS.md:329`). Anything built on top of a period selector
before T4 lands inherits the cap.

## D4 — Buildings screen is hard-locked to the current calendar month

`web/app/locations/page.tsx:180-192`, `const from = periodStart('month', new Date())`, consumed at
`:271` and rendered at `:987`. No selector, no reset, no "letzter Monat".

Executed against live data: HOIV → `minutes=0, pending=0` → cell reads *"0:00 in diesem Monat
geleistet"*. With a Sollzeit set it will also assert *"Das sind 40:00 unter der Sollzeit."* four days
after the building was cleaned.

This cell is the input to "are we overservicing this contract" and therefore to renegotiating a
contract price. For the first days of every month it answers with a whole month missing.

## D5 — Clearing "Ende" silently reopens a paid shift and locks the worker out

`web/app/shifts/page.tsx:277` — the empty-end branch is a valid state, by design.
`web/app/shifts/page.tsx:293` — `patch.end_time = null` is then sent.
`server/routes/admin.js` `patchShift` accepts `endRaw === null` and writes it.

Cascade, all silent:
1. shift becomes `open` → excluded from payroll (`lib/shifts.ts:38`) and from the server aggregate;
2. the worker now holds their one open-shift slot on a July date and **cannot clock in anywhere**
   (`POST /admin/shifts` overlap rule; the phone path has the same partial unique index);
3. `ops/sql/autoclose.sql` closes it at `start + 8h` with `auto_closed = true, corrected_at = NULL`
   → an unresolved 8-hour stub that now blocks payroll and requires worker-side resolution
   (decision-10).

`endHint` warns in prose. There is no confirmation and no undo. One keystroke plus Save.

## D6 — Deactivation irreversibly revokes client links, unconfirmed, and the two paths differ

- `web/app/clients/page.tsx:235` `toggleContact` → `DELETE /admin/contacts/:id` → server revokes
  every live grant. Reactivating (`saveContact({active:true})`) does **not** restore them.
- `server/routes/admin.js` `deleteLocation` also revokes; but the buildings screen's "Deaktivieren"
  goes through `saveLocation({active:false})` (`web/app/locations/page.tsx:438`), which does
  **not**. So the same word on two screens has two different destructive footprints.

No confirmation on either. Nothing tells the director the link he sent his client just died. The
correct wording is decided; the missing piece is saying it before the click and making the two
paths agree.

## D7 — No plausibility bound on the hourly rate

`server/lib/validate.js:106-110` — `cents()` accepts `0 … 100_000_000`, i.e. up to €1,000,000 per
hour. `web/lib/money.ts:11` accepts up to six whole euro digits. The live aggregate
(`pay_cents 5118` for `hours 0.341`) implies about **€150/hour**.

Either that is genuinely the rate, or somebody typed a monthly figure into an hourly field. Nothing
on `/workers/`, `/shifts/` or `/payroll/` questions it, and the payroll CSV goes straight to the
accountant. A soft ceiling with a confirm ("€150,00 pro Stunde — ist das richtig?") is a trust
boundary, not a nicety; do not simplify it away.

## D8 — Payroll dates by start, the client portal dates by end

`web/lib/payroll.ts:57-61` (`startsWithin`, stated on screen via `attributionHint`) vs
`server/routes/portal.js:105` (`to_char(s.end_time AT TIME ZONE 'Europe/Vienna', 'YYYY-MM-DD')`).

A shift 31.07. 23:30 → 01.08. 00:30 is paid in July and shown to the client as an August cleaning.
Pick one rule, apply it in both places, or state the difference on the portal.

## D9 — Dashboard times are in the browser zone, the shift log's are Vienna

`web/app/page.tsx:114-118` and `:179` call `format.dateTime` with **no `timeZone`**.
`web/app/shifts/page.tsx:326-332` pins `BUSINESS_TIME_ZONE`. `web/app/locations/page.tsx` (grant
date) also omits it.

On a laptop set to anything but Vienna the two screens disagree by up to two hours, and near
midnight by a day. `lib/shifts.ts` already explains at length why this must be pinned; the dashboard
just does not use it.

## D10 — Client portal silently caps at 20 cleanings

`server/routes/portal.js:41` `RECENT_CLEANINGS = 20`. `web/app/reinigung/page.tsx` renders whatever
arrives with no note. A client on a daily contract sees three weeks and assumes that is the whole
record. One sentence under the table.

## D11 — `shifts.resultCount` has no ICU plural

`web/messages/de.json:351` `"{count} Schichten angezeigt."` and `en.json` likewise.
One result reads *"1 Schichten angezeigt."* `scripts/check.mjs` cannot catch this (it compares
placeholder **sets**, not plural categories). Use the ICU parser already in the tree if the message
becomes a plural.

## D12 — `payroll.summary` has no ICU plural

`web/messages/de.json:84` `"{period} – {workers} Mitarbeiter, {hours} Stunden, {amount}."`
`{hours}` is pre-formatted by `format.number`, so it arrives as `"1,00"` — a plural on it needs care.
`{workers}` is fine (*Mitarbeiter* is invariant in German), which is the only reason this reads as
half-broken rather than fully broken.

## D13 — *Einsatz* vs *Schicht*

`web/messages/de.json:238, 252, 256` and `locations.truncatedNote` say **Einsatz**;
`shifts.*`, `home.*` and `payroll.*` say **Schicht**. One concept, two words — the rule
`AGENTS.md` sets and that `backlog/docs/DIRECTOR-DASHBOARD.md` already records as fixed once for
*Objekt*/*Gebäude*. It regressed on a different word.

## D14 — *Kurzkürzel*

`web/messages/de.json:181, 211, 213, 223`. *Kurz* + *Kürzel*. Use *Kürzel* or *Kurzname*.

## D15–D20 — annoyances

- **D15** No confirmation on any "Deaktivieren": `workers/page.tsx:213`, `locations/page.tsx:438`,
  `clients/page.tsx:220` and `:235`, `inventory/page.tsx` `toggleActive`.
- **D16** `web/lib/api.ts:505` `fetchClientsSnapshot` requests `/admin/data` with no `limit`,
  pulling 500 shift rows plus the `hours` aggregate that screen never reads.
- **D17** `web/app/login/page.tsx:44` always `router.push('/')`; no redirect for an already-valid
  session.
- **D18** `web/app/payroll/page.tsx:92` `const [now] = useState(() => new Date())`.
- **D19** `web/app/not-found.tsx` renders inside `AppShell`, so a signed-out mistyped URL shows the
  full admin nav and a "Abmelden" button.
- **D20** `web/components/DesktopOnlyGuard.tsx:21-46` — children mount and fetch behind
  `display:none`. Documented ceiling; the cost is now a 2000-row payload per screen on a phone.

---

# Part C — what the dashboard should show on a Monday morning

## The question the current screen answers, and the one he asked

`/` answers **"is anything broken?"** — open shifts, unresolved shifts, workers who can never log
in, buildings with no taps. Every block links to its fix. That is a good screen and the reasoning in
its header comment is right: *a number with no action attached does not belong on this page*.

The director opened it expecting **"what did my company do?"** and got *"Nichts zu tun."* He
concluded the data was gone. He was half right — two other screens genuinely were hiding it — but
his expectation is also legitimate and unserved: there is currently **no screen in the panel that
answers "what happened recently"** without first passing a period filter that defaults to hiding it.

## The one change

**Add one block to the dashboard, directly under the summary line and above "Gerade im Einsatz":
the last N completed shifts, newest first, as a plain list — day, worker, building, duration — with
no period filter of any kind, and a link to `/shifts/`.**

Not a metric. Not a chart. Not hours-this-month, not euros-this-month, not a comparison against
last month. A **log**: the last ten things that happened, in the order they happened.

### Why this and not a KPI tile

1. **It cannot be wrong.** Every number on this panel that has been wrong has been wrong because it
   was scoped to a period (D1, D2, D4). "The last ten shifts" has no period, no boundary and no 1st
   of the month. It is the one shape of activity display that survives every defect above, including
   the ones not fixed yet.
2. **It is the only answer to "is it working".** The director's real question on Monday is not
   "how many hours in July"; it is *"did my people tap in and did the system record it"*. Five rows
   with names and durations answers that in two seconds. An hours-this-month tile would today read
   `0,00 €` and re-create the exact alarm we are fixing.
3. **The data is already in the payload.** `snapshot.shifts` is already fetched and already sorted
   `start_time DESC` by the server (`server/routes/admin.js:131`). This is a `.filter(end_time !==
   null).slice(0, 10)` and a table. No new route, no new state, no new dependency. Ponytail rung 4.
4. **It restores trust cheaply.** The panel's problem is not that it computes wrong; payroll is
   careful and honest. The problem is that its front door says "nothing" when there is something.

### What it must NOT cost

The reason `/` exists is the **exception signal**. That signal must survive intact:

- **The summary line stays first and stays unchanged.** *"N Punkte brauchen Ihre Aufmerksamkeit"* /
  *"Nichts zu tun"* is the first thing read, by eye and by screen reader. The activity block goes
  **after** it, never above it, and never inside the same live region.
- **"Gerade im Einsatz" and "Zu erledigen" keep their current prominence and their links.** The
  activity list gets no link that competes with them and no `row-attention` styling.
- **The activity list must not be able to change `problemCount`.** It is read-only history; it
  contributes nothing to the "something is wrong" arithmetic at `web/app/page.tsx:121`.
- **No colour, no badge, no count on the activity block.** The moment it grows a number, the eye has
  two numbers to compare and the exception signal is diluted. Words and rows only.
- **It must be visibly bounded.** *"Die letzten 10 abgeschlossenen Schichten"* as a heading, with
  *"Alle Schichten ansehen"* linking to `/shifts/`. Never presented as a total, never summed. If it
  is ever summed, it becomes a period number and inherits D1 through D4.
- **It must not add a round trip.** Same `/admin/data` call, sliced a fifth way — exactly as the
  file header already promises.

One sentence of acceptance criteria for the fix agent: *on 2026-08-03 with the live data, the
dashboard shows five completed shifts from 30 July, and the summary line still says "Nichts zu
tun."* Both facts, on one screen, at the same time. That is what the director asked for and what he
did not get.
