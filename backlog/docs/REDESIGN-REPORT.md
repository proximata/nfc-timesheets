# The admin redesign: what shipped, what was checked, what is still wrong

Commit `b5c30fd` ("the admin redesign lands") converted all 13 admin screens to the flat,
dark-by-default design system in `docs/brand/prototype.html`. It shipped **unverified**: the
run's Verify, Fix, Demo and Review agents each died with *"Subagent produced no assistant
output"*, so no screenshot had been taken, no contrast ratio computed and no review done.
Three passes have since looked at it — `REDESIGN-VISUAL.md` (weight and layout),
`REDESIGN-A11Y.md` + `REDESIGN-FIX.md` (contrast, keyboard, overlays, 390px), and this one,
which **filmed** it.

Date of record **2026-08-17**, Europe/Vienna. Everything below was produced against a local
`nfc_demo`, served same-origin by `server/server.js` with `PUBLIC_DIR=../web/out`.
`sh demo/check-guards.sh` → **OK, 16 refusals still refuse**, run before anything else.
Production was never contacted and nothing was deployed.

---

## 1. The verdict on the complaint

The owner's complaint was that the admin *"feels heavy: too much text, two stacked white
containers, forces me to READ a whole screen instead of skimming it"*.

**The redesign fixes it, and the film shows why.** The mechanism is the same on every screen
and it is the right one:

```
heading → ONE question → the ANSWER as figures → then the evidence
```

`/payroll/` asks „Was ist diesen Monat auszuzahlen?" and answers it in four figures before
any table appears. `/` asks „Muss ich gerade etwas tun?" and answers **3** and **1**. The
create forms that used to sit above the list — the second white container — are in drawers,
so the list *is* the page.

**The "every screen got longer in source" alarm was a false alarm**, and it was always going
to be: moving a form into a drawer adds markup while removing it from the page. Rendered page
height went **down** on 10 of 13 screens (`REDESIGN-VISUAL.md` §1, measured before and after
from a `git worktree` build of `b5c30fd~1`), e.g. `/workers/` 1888 → 1000 px, `/clients/`
1953 → 1000 px.

Colour is genuinely the second signal: state is carried by a 3 px left rule, by weight, by
position and by the word itself (*„Nicht bestätigt"*, *„Tag prüfen"*).

---

## 2. The six load-bearing truths — all intact, all filmed

Each was asserted **on camera**, at the moment the camera was on it, by
`demo/record-redesign.mjs`. The run dies rather than narrating something that is not there.

| # | Truth | Evidence |
|---|---|---|
| 1 | `/login/` is `type="text"` `autoComplete="username"` | asserted before a single character is typed. Not an e-mail field ∴ the client is not locked out |
| 2 | `/workers/` enrolment code is an **inline** panel, shown once, expiry visible **at copy time** | asserted `!document.querySelector('[role="dialog"]')` + „Gültig bis" + „Zugangscode kopieren" all present together |
| 3 | `/shifts/` has **two** drawers | „Schicht korrigieren" Ende `required === false`; „Schicht nachtragen" Ende `required === true`. Two drawers, not one behind a mode flag |
| 4 | `/payroll/` reconciliation line **and named** exclusions | „Die hier geladenen Schichten ergeben genau die Summe des Servers"; then the period is switched to a month that *has* exclusions, which are counted, named and linked („Jetzt bestätigen") |
| 5 | `/locations/` copies `https://schimmer-glanz.exe.xyz/t?l=<uuid>` | shape-tested for a UUID (decision-21), then **the clipboard is read back** and compared to the row's own URL |
| 6 | Deactivation is soft | „Deaktivieren" / „Wieder aktivieren" on the same rows; Tomasz Wojcik is inactive and still present |

A worker with **no hourly rate** is an explicit exclusion, never a silent `0,00 €`:
`payroll.rowNoRate` = „Kein Stundensatz", `caveatNoRate` and `answerExcludedNoRate` count and
name them. ✓

`/reinigung/` was verified chrome-free by the earlier pass and is not in this film.

---

## 3. What this pass found that the earlier ones did not

### F1 — horizontal overflow at laptop widths ⚠ NOT FIXED

`/workers/` and `/locations/` scroll sideways below 1440 px. The earlier passes audited
**390** and **1680** and both are clean, so the whole laptop range went unexamined.
Measured, `scrollWidth − clientWidth`:

| width | `/workers/` | `/locations/` | `/shifts/` | others |
|---|---|---|---|---|
| 1024 | **+389** | **+369** | **+60** | ok |
| 1280 | **+133** | **+113** | ok | ok |
| 1366 | **+57** | **+38** | ok | ok |
| 1440 | ok | ok | ok | ok |
| 1680 | ok | ok | ok | ok |

At 1280 the *Aktionen* column — „Bearbeiten", „Deaktivieren" — is cut off the right edge, and
the name column wraps to „Andrea / Steiner". This is a real defect for anyone on a 1280
external display or a half-screen window. It is **not** the 390 px case, which is clean:
below the breakpoint the tables become stacked cards and there is no overflow at all. The
dead zone is 1024–1366.

Effort to fix: **low–medium**. Same treatment the phone breakpoint already gets, applied one
step earlier, or fewer columns (`REDESIGN-FIX.md` D3 already calls `/locations/`
over-columned at nine).

### F2 — the shift correction drawer has no reason field ⚠ NOT A REGRESSION

The demo brief asked for „Schicht korrigieren" *"showing the reason field"*. **There is no
such field, and there never was.** Checked three ways: no input or textarea for it in the
drawer, no key for it anywhere in `messages/de.json`, and no column for it on `shifts` —
`patchShift` in `server/routes/admin.js` accepts only `worker_id`, `location_id`,
`start_time`, `end_time`.

Nothing was faked. Segment 3 films what the drawer **does** carry, which is the honest
equivalent: a statement of what saving actually does — the shift was closed by the 8-hour
timer, and on save it counts as confirmed and its hours enter the payroll. The caption says
so in those words.

Worth having: an audit trail on corrections is a real gap for a payroll system, but adding a
column is a schema change and belongs in a task, not in a demo run.

### F3 — `workers.rateOptionalHint` now contradicts `/payroll/` ⚠ NOT FIXED

`messages/de.json` → `workers.rateOptionalHint` says a worker without a rate

> „…erscheint in der Lohnabrechnung mit 0,00 € **statt als offener Punkt**…"

That is exactly backwards. `/payroll/` names them as a counted exclusion (`rowNoRate`,
`caveatNoRate`, `answerExcludedNoRate`) — which is the behaviour the product wants and the
one truth #4 depends on. The hint is stale copy from before that landed, and it tells the
operator the opposite of what the software does. **Copy-only fix, effort: low.** Left alone
here because copy changes are owner-present work (`REDESIGN-FIX.md` §5 makes the same call
for D9–D12).

---

## 4. What was fixed in this pass

All four are in `demo/`. None of them touch application behaviour.

| | Defect | Fix |
|---|---|---|
| H1 | `record()` truncated the tail: a screencast emits no frames while nothing moves, so a segment ending on a still screen encoded **short** — `/payroll/` drove 27.9 s and encoded 15.4 s — and its last captions were drawn over the **next** segment's footage | the tail is held in the filter (`tpad=stop_mode=clone`) to the drive's own length, and the encoded length is measured and asserted. Reconstructing it in the concat list does **not** work: the demuxer drops the final `duration` without a repeated file and applies it **twice** with one (measured: a 20.0 s list encoding to 24.0 s) |
| H2 | a segment's last caption ran on until the *next* segment's first caption fired — „die Zwischenablage enthält genau diese URL" sat 2.5 s over the phone segment | `captionDrawtexts` now honours an explicit `until`, capped at the segment boundary |
| H3 | a caption lingered over the *next page* during a 2.6 s settle inside segment 6 | short settle, `waitFor` the heading, then speak — the caption still lands after the screen, never before it |
| H4 | a stray headless Chrome from an earlier run answered on the same port, so `attach` silently drove **that** browser at the previous run's viewport — a 390 px pass that actually rendered at 1680 | kill by port and **wait** for it to die (`pkill` returns before the process is gone, and `launchChrome` then hit `ENOTEMPTY` on the profile it was still writing) |

`record-admin.mjs` has the **same** H1 drift, since its caption times are drive-relative too;
`docs/media/admin-walkthrough.mp4` was cut before the fix. Not re-cut here — out of scope,
worth a task.

One further thing, which was the **harness and not the app**: headless Chrome is never the
focused document, and `navigator.clipboard.writeText` rejects with `NotAllowedError` on an
unfocused one, so the tag-URL button landed on its manual-copy fallback every time. Measured
both ways —

```
focusEmulation=false   hasFocus=false   writeText=REJECTED: NotAllowedError
focusEmulation=true    hasFocus=true    writeText=ok
```

— and fixed with `Emulation.setFocusEmulationEnabled`. The fallback the app showed is correct
software; it was simply not what the demo is of.

---

## 5. Every check was broken on purpose first

A check whose negative case cannot fail is not a check. This project has been bitten four
times, so:

- **The caption/clip-length guard.** The tail fix in `demo/cdp.mjs` was reverted on purpose
  and the run re-executed:

  ```
  Error: segment 04-lohn: last caption starts at 22.9s but the clip is only 15.4s
         — it would be drawn over the next segment. ("Und pro Zeile steht, was an ihr nicht gezählt wurde.")
  ```

  Restored → green. RED shown before it was trusted.

- **The clipboard comparison caught its own author.** The first cut read the *first* tag URL
  on the page while clicking *Handelskai*'s button, and failed loudly:

  ```
  Error: clipboard holds "…/t?l=bf236e1b-…", the row shows "…/t?l=76dc5912-…"
  ```

  Six rows, six URLs, all the right shape — a probe that matches any row proves nothing about
  the row on camera. Exactly the card-label-probe mistake. Now scoped to the clicked row.

- **The viewport override is asserted**, not assumed: a 390 px pass that renders at 1680
  throws instead of quietly producing a wide picture with a narrow caption.

- **`demo/check-captions.mjs` still passes** after `captionDrawtexts` was split out of
  `captionFilter`, so the half-open caption window has one implementation and one test.

- **The film was looked at**, tiled at 7-second intervals and again at every segment boundary.
  Both caption defects above were found that way and not by reading code.

---

## 6. The film

`docs/media/redesign-demo/admin-redesign.mp4` — 169.8 s, 1440×1032, H.264, **no audio track**
(`-an`), 39 burned-in German captions, 7 segments, `segments.json` beside it.

| # | Segment | What it proves |
|---|---|---|
| 1 | Anmeldung und Übersicht | dark by default; username not e-mail; the dashboard leads with its answer |
| 2 | Mitarbeiter einladen | the whole invite, drawer → submit → **enrolment code inline with „Gültig bis"** |
| 3 | Schicht korrigieren | two genuinely different drawers; what saving does (see F2) |
| 4 | Lohnabrechnung | reconciliation line, then a period where exclusions exist, counted and named |
| 5 | Tag-URL kopieren | the wall-tag string, copied, **read back out of the clipboard** |
| 6 | Dieselbe Arbeit am Telefon | 390 px, no horizontal scrolling on `/`, `/payroll/`, `/workers/` |
| 7 | System / Dunkel / Hell | the light theme through the real control |

Nothing is drawn, annotated, sped up or reordered. Every frame is headless Chrome rendering
the built export against the demo database. The only edit is a held last frame per segment,
which is a visible still. No home screen, no notifications, no other application, no real
customer data — everyone in `demo/seed.sql` is invented, every address is `@example.test`, and
worker phone numbers are left empty because an invented Austrian mobile number in a public
repo is somebody's real number.

Copied to the demo library at `~/Desktop/demos/hoiv/nfc-timesheets/`.

### Re-recording it

```sh
sh demo/check-guards.sh
psql -q -d nfc_demo -f demo/seed.sql
DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
cd web && NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
cd server && DATABASE_URL=postgres:///nfc_demo \
  APP_KEY=tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65 \
  PORT=8082 PUBLIC_DIR=../web/out node server.js &
cd ..
node demo/record-redesign.mjs
```

**Re-seed first.** Segment 2 creates a worker („Bianca Reiter") and issues a code; a second
run without a re-seed opens on a list that already has her.

---

## 7. Left deliberately

Carried forward from `REDESIGN-FIX.md` §5, unchanged and still the right calls:

- `--border` at 1.26:1 — a decorative hairline; WCAG 1.4.11 does not cover it, and 3:1 would
  print a spreadsheet grid across a design system whose first word is *flat*.
- `/account/` uses `role="status"` rather than `alert` — one permanently mounted region
  carries both outcomes, declared as a ceiling.
- `.brand` at 24 px and in-sentence links at 38 px — 2.5.8 AA is met; 2.5.8 explicitly excepts
  links inside sentences.
- D3/D4/D9–D12 copy-and-layout items — owner-present work.

New, from this pass: **F1** (laptop-width overflow) is the one that should be picked up first;
it is a real defect at a real width. **F3** is a two-minute copy fix that currently tells the
operator the opposite of the truth. **F2** is a product decision, not a bug.
