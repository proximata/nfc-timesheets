# Adversarial review of the admin redesign

Gate on `b5c30fd` (the redesign) + `3211e32` (the a11y/fix pass). Written 2026-08-17.

Posture: disbelief. Nothing below is taken from the other agents' reports. Every number was
re-measured on this machine, against `nfc_demo`, with probes written for this review
(`demo/review-probe.mjs`, `demo/review-weight.mjs`) rather than by re-running theirs — except
where the point was specifically to test THEIR check, which is §5.

**Verdict: SHIP WITH LISTED DEFECTS.** The redesign answers the complaint. One regression
introduced by the fix commit has to be fixed before anyone opens the panel on an iPad, and one
sentence of German copy tells the admin the opposite of the truth about money.

---

## 1. `pnpm verify` — GREEN

`git diff HEAD -- web/ server/` is empty, so the working tree IS the checkout.

```
$ cd web && pnpm verify
All checks passed.                       (24 checks)
Checked 58 files in 87ms. No fixes applied.
$ tsc --noEmit                           (silent)
✓ Compiled successfully in 1252.3ms
✓ Generating static pages (16/16)
EXIT=0
```

---

## 2. The owner's question: is it actually lighter?

**Yes. I agree with the visual pass, and independently.** Both trees were built, served
same-origin off the SAME seeded `nfc_demo`, and measured by the same probe in the same browser
at 1680×1000 dark. Three numbers, one per clause of the complaint:

| | px (screen height) | read (words before the first datum) |
|---|---|---|
| dashboard | 1282 → **1391** ⚠ +9% | 22 → **5** |
| shifts | 6859 → **6062** −12% | 137 → **5** |
| material-requests | 1884 → **1605** −15% | 189 → **6** |
| workers | 1888 → **986** −48% | 181 → 86 ⚠ |
| locations | 3334 → **2011** −40% | 176 → 71 ⚠ |
| clients | 1953 → **913** −53% | 34 → 44 ⚠ |
| contracts | 1138 → **1002** −12% | 113 → **6** |
| inventory | 1486 → **913** −39% | 55 → **7** |
| payroll | 1181 → **1047** −11% | 141 → **5** |
| pl | 2095 → **1787** −15% | 265 → **5** |
| analytics | 1733 → **1655** −5% | 182 → **5** |
| account | 913 → 913 — | 16 → 16 |

11 of 12 shorter or level; only the dashboard grew, and it grew because it gained two figures
and an attention list — **22 words of prose became 5**, so it is more skimmable at greater
height. Prose above the first datum fell **1511 → 251 words** across the twelve.

The "every screen got longer in SOURCE" alarm was false, exactly as suspected: the drawer
markup moved off the page and into a dialog.

**The mechanism is real, not cosmetic.** `/clients/` was the complaint verbatim — two stacked
white containers, form-over-table, twice. It is now one hierarchy table with the two forms in
drawers, and it fits one screen. Compare `docs/media/redesign/before/clients-1680-dark.png`
with `docs/media/redesign/clients-1680-dark.png`; nothing else in this document is as
convincing as those two images side by side.

**Where the claim overreaches.** The visual pass said explainers were "demoted BELOW the
data". True on nine screens. **False on `/workers/`, `/locations/` and `/clients/`**, where a
tinted note still sits above the first row — 86 words on `/workers/` before you see a name,
and on a phone that is eleven lines of scrolling before the first worker. That is the residual
of the original complaint and it is the cheapest remaining win.

**Greyscale: PASS, confirmed by my own desaturation** (`ffmpeg -vf hue=s=0`). Every state is
carried by the word (`Nicht bestätigt`, `Kein Stundensatz`, `Inaktiv – keine Anmeldung
möglich`), a 3px left rule, a hatched fill, or position. Hue is never load-bearing.

One deviation from the brief, accepted: the attention states use an amber, so there is a
second hue beside the blue accent. It survives greyscale, so it is decoration on top of a
word, which is what the brief actually asks for.

---

## 3. Decision compliance — no violations

Every record in `backlog/decisions/` read. Checked, not assumed:

| Decision | Evidence |
|---|---|
| 28 (phone) | sidebar at 767px `display=flex`, 12 links, `overflow-x:auto`, `scrollWidth 1072 > clientWidth 767` — a strip, never `display:none`. Document h-scroll 0 at both 767 and 390. Payroll reconciliation + named exclusions still visible at both. `tbody tr display=block` at 390 — cards, not a table. |
| 28 (contract history) | `/pl/` renders the `rate_basis` limitation in a permanently visible `.callout`, not a `<details>`, not a tooltip. `/analytics/` has no such line — **pre-existing gap, not a redesign regression**: `git show 60c5861:web/app/analytics/page.tsx` has none either. |
| 17 / 8 | `next-intl`; de.json and en.json key sets identical (mutation-proved, §5). No hardcoded German in JSX. `audit-german` 9/9. |
| 20 | No admin PIN anywhere in `web/`. The only `pin` hits are Google Maps map-pins and two comments saying the PIN is gone. |
| 21 | Rendered tag URI is `https://schimmer-glanz.exe.xyz/t?l=<uuid>` — UUID, never the slug. The slug (`landstrasser-46`) is displayed separately as a human label. |
| 9 / 3 | 9 dependency specifiers, zero `^` or `~`. `.npmrc` has `save-exact=true`. Biome, pnpm, no ESLint/Prettier. |
| 16 / 23 | `server/package.json` deps are exactly `pg` + `@sentry/node`. `git diff 60c5861..HEAD -- server/ NFCTimeSheets/ android/ ops/` is **empty** — the redesign never touched them. |
| 24 | `node ops/check-branding.mjs` → `check-branding: OK`, 6 checks. |
| dependency budget | **No new npm dependency.** `@formatjs/icu-messageformat-parser`, used by `web/scripts/check.mjs`, is reached through pnpm's store as an existing transitive of `next-intl`; `package.json` is unchanged. Documented as a `ponytail:` shortcut that fails loudly. Acceptable, and brittle in exactly the way its own comment says. |

---

## 4. The load-bearing truths — all present, all re-verified live

`demo/review-probe.mjs` — 36 checks, 0 failures, against the built export served same-origin.
Every one reads text or a computed style and compares it to an expected string. **None of them
counts elements**, because counting is how this repo shipped cards captioned with the wrong
column.

```
### T0 /login/ — the field is a USERNAME
  ok   login field is type=text — type=text
  ok   login field autocomplete=username — autocomplete=username
  ok   login field is labelled as a username, not an e-mail — "Benutzername"

### T1 /payroll/
  ok   payroll states the server-vs-visible reconciliation — „… ergeben genau die Summe des Servers … fehlt nichts.“
  ok   a worker with no hourly rate is a NAMED exclusion — Marta Nowak | 21,50 | Kein Stundensatz | Nicht bewertet | Kein Stundensatz
  ok   …and is NOT silently valued at 0,00 € — Betrag cell = "Nicht bewertet"
  ok   exclusions are counted, with a figure — "2 Schichten müssen"
  ok   unresolved auto-closed shifts are named as an exclusion

### T2 /locations/
  ok   the tag URI is shown in full, host + /t?l=<uuid> — https://schimmer-glanz.exe.xyz/t?l=f673208a-…
  ok   a per-row copy control exists on the tag URI
  ok   …and it puts THAT ROW's url on the clipboard — clipboard="https://schimmer-glanz.exe.xyz/t?l=f673208a-…"

### T3 /workers/
  ok   the enrolment code is NOT in a modal or drawer — host=null
  ok   no dialog opened at all — [role=dialog] count=0
  ok   the code itself is on screen — R0TD-D7VT
  ok   its expiry is visible AT COPY TIME — Gültig bis 22 / Zugangscode kopieren

### T4 /shifts/
  ok   „Schicht nachtragen“ is its own drawer
  ok   „Schicht korrigieren“ is a DIFFERENT drawer
  ok   nachtragen requires an end time — end field Ende* required=true
  ok   korrigieren leaves the end time optional — end field Endeoptional required=false

### T5 deactivation is soft
  ok   an inactive worker is still listed, with their history — Tomasz Wojcik … Inaktiv – keine Anmeldung möglich
  ok   …and can be reactivated
  ok   nothing on the screen offers to delete

### T6 /reinigung/
  ok   no admin navigation — nav a=0        ok   no theme switcher
  ok   no admin-only vocabulary leaked in   ok   no Abmelden
```

Three notes on how these were made to be able to fail:

- **The payroll checks went RED on the first run** — `no row mentions Kein Stundensatz`. That
  was correct: the stock seed gives every worker a rate and the default period holds no
  unresolved shift, and the page truthfully said `Nicht gezählt 0 · Keine Schicht offen oder
  unbestätigt`. The probe was creating the zero-rows trap. It now zeroes a rate and selects
  the month that contains the exclusions, which is the only way the assertion means anything.
- **The tag-URI copy compares the clipboard against the URL of the ROW whose button was
  clicked**, not against the first URL on the page — the mistake the demo agent caught in
  themselves.
- **`docs/media/redesign/truth-locations-tag-copied.png` is mislabelled.** It shows a red
  banner reading `Tag-URL von Aerztezentrum Landstrasse konnte nicht kopiert werden`. The copy
  path works — I read the string back out of the clipboard above — but that file documents a
  failure under a name claiming success.

---

## 5. Mutation testing the other agents' checks — 4 of 4 went RED

Each mutation was applied to the real source, rebuilt, run, and reverted. The tree is byte-identical afterwards (`git diff --stat web/` empty).

**M1 · the data-loss fix** — removed `key="next"` / `key="save"` from `web/app/locations/page.tsx`, undoing the C1 fix:

```
RED    FAIL locations: pressing "Weiter" does NOT save and close the drawer  — drawer=false
       FAIL locations: the step really advances  — Schritt 1 von 2 · Objekt und Kunde → null
       psql> Auditobjekt | contracts 0        ← the Objekt really was saved with no contract
GREEN  ok   locations: pressing "Weiter" does NOT save and close the drawer  — drawer=true
       ok   locations: the step really advances  — … → Schritt 2 von 2 · Vertrag und Zeit
       psql> Auditobjekt — 0 rows             ← nothing saved prematurely
```

The C1 bug was real, the fix is real, and `audit-overlays2.mjs` genuinely detects it. It is
also the fifth instance in this repo of a check that could not fire, and the reason it can now
is that it drives `Input.dispatchMouseEvent` instead of `el.click()`.

**M2 · de/en parity (decision-17)** — added one key to `de.json` only:

```
RED    FAIL messages/de.json: key set identical to en.json
         extra:   [payroll.__mutationOnlyInGerman]
       1 check(s) failed.   EXIT=1
GREEN  All checks passed.   EXIT=0
```

**M3 · contrast** — reverted dark `--text-muted` to its pre-fix `#6c7178`:

```
RED    FAIL   3.98:1  need 4.5:1  --text-muted on --bg-base
       FAIL   3.72:1  need 4.5:1  --text-muted on --bg-raised
       FAIL    3.4:1  need 4.5:1  --text-muted on --bg-overlay
GREEN  ok     5.78:1 / 5.4:1 / 4.93:1
```

**M4 · decision-28** — added `.sidebar { display: none }` inside `@media (max-width: 767px)`:

```
RED    FAIL dark 360 /  — sidebar hidden — Q5 says it must stay as a strip
       …the same on all 12 screens × 2 themes
GREEN  0 occurrences of "sidebar hidden"
```

I also broke my own weight probe on purpose (prose walker pointed at `<body>` instead of
`#main-content`); every screen's `read` moved by the ~4–9 words of chrome, so it is reading the
DOM and not a constant.

---

## 6. What is still broken

### R1 · HIGH — the panel scrolls sideways between 768px and 1439px, and `3211e32` caused it

Bisected across three builds, same probe, same widths, same data:

| width | 60c5861 (before) | b5c30fd (redesign) | 3211e32 (HEAD) |
|---|---|---|---|
| 1024 | clean | clean | shifts **+60**, material-requests **+78**, workers **+239**, locations **+369** |
| 1280 | clean | clean | locations **+113** |
| 1366 | clean | clean | locations **+38** |
| 1440 | clean | clean | clean |

At 1024px `/locations/` loses **Kundenlink, Status and Aktionen** off the right edge —
`Bearbeiten` and `Deaktivieren` are off-screen (`/tmp/rev-shots/locations-1024.png`).

Cause, and it is an honest one: the fix commit changed table cells from `overflow-wrap:
anywhere` to `break-word` and gave `.code-block` a `min-width: 24ch` floor. Both were right —
they killed `STUN/DENS/ATZ` and the one-character-per-line tag URL. But they raise each
table's min-content width, and the row-to-card transform only covers ≤767px, so the new
minimum lands inside the 768–1439 band. **The fix pass verified 390 and 1680: the two widths
on either side of the band it broke.**

decision-28 says it in as many words: *"Any future screen that answers this with a horizontal
scrollbar has missed the point of this record."*

Not a hard block — the page does scroll, so nothing is unreachable — but 1024 is an iPad in
landscape and a half-width laptop window, which is precisely the field use decision-28 exists
for. Effort: low-to-medium. Either widen the card transform's breakpoint for the wide tables,
or shed columns from `/locations/` (nine is a content decision, as the fix pass already said).

### R2 · HIGH — `workers.rateOptionalHint` states the opposite of what payroll does

```
de: … Ohne Stundensatz erscheint diese Person in der Lohnabrechnung
    mit 0,00 € statt als offener Punkt – bitte nachtragen …
en: … Without a rate this person appears in payroll at €0.00 rather than
    as an open item …
```

`/payroll/` does the opposite, and correctly: `Kein Stundensatz` / **`Nicht bewertet`**, named
and counted as an exclusion, never `0,00 €`. This sentence sits in the one field where the
admin decides whether to leave a rate blank, and it tells them a rate-less worker is silently
zeroed. It is wrong about money in both locales. Effort: low — two strings.

### R3 · MEDIUM — three of the seven audits are RED at HEAD, with no allowlist

```
audit-phone      exit=1     24/26 FAIL   .brand h=24, in-sentence links h=38
audit-contrast   exit=1     4 FAIL       --border 1.26:1
audit-overlays2  exit=1     1 FAIL       /account/ has no role="alert"
audit-table-words exit=0    11/11        audit-keyboard exit=0   13/13
audit-german      exit=0     9/9         audit-focus-ring exit=0 12/12
```

Every one of those failures is argued and deferred in `REDESIGN-FIX.md` §5, and I agree with
each argument on the merits — `.brand` at 24px satisfies 2.5.8 AA, in-sentence links are
excepted, `--border` is a decorative hairline that 1.4.11 does not reach, `/account/`'s
`role="status"` carries both outcomes. **But the scripts exit 1 anyway**, so a genuine new
regression is now indistinguishable from the expected red, and `audit-phone` prints 24 failure
lines nobody will read past. Either encode the expected failures as a named allowlist the
script asserts against, or lower those three thresholds to what was actually decided.

### R4 · MEDIUM — three screens still lead with prose

`/workers/` 86 words, `/locations/` 71, `/clients/` 44 above the first datum. Everything else
is 5–7. On a phone `/workers/` is eleven lines of explanation before the first name. Same
treatment as the other nine: put the note under the table.

### R5 · LOW — the evidence directory is mixed vintage

`docs/media/redesign/*.png` are 18:22–18:24 (pre-fix). Only the nine files in `after-fix/` are
19:23–19:25 (post-fix). Anyone reading the top-level shots is looking at the *unfixed* build.
Either re-shoot the top level or move it to `before-fix/`.

### R6 · LOW — 62 untracked files, some of them the only copy of the work

`backlog/docs/REDESIGN-{A11Y,VISUAL,REPORT}.md`, 11 `demo/audit-*.mjs`, the two probes from
this review, `docs/media/redesign/`, `docs/media/redesign-demo/`. **`git clean` destroys all of
it.** Not mine to commit; flagged so it is a decision rather than an accident.

### R7 · LOW — `AGENTS.md` still says the tag host is `timesheets.exe.xyz`

Rendered and copied to the clipboard: `schimmer-glanz.exe.xyz`. `ops/branding.json` is the
source of truth (decision-24) and it agrees with the UI, so this is doc drift only.

### Carried forward, unchanged and still true

D3 `/locations/` is over-columned at nine. D9 `/pl/` repeats „keine Zielmarge gesetzt" five
times. D10 payroll's KPI caption mixes shifts and workers. D11 copy feedback lands far from
the button. D12 the 390px nav strip scrolls with no affordance. F2: the correction drawer has
no reason field and never had one. `record-admin.mjs` still has the caption tail drift that
`record-redesign.mjs` fixed, so `docs/media/admin-walkthrough.mp4` was cut before the fix.

---

## 7. Verdict

**SHIP WITH LISTED DEFECTS.**

The redesign does what it was asked to do, and it is the first version of this panel that can
be skimmed. Nine of nine load-bearing truths survive, verified live rather than read off a
screenshot. No decision is violated. The C1 data-loss bug that `b5c30fd` shipped is genuinely
fixed and the fix is genuinely detectable.

R2 should go in first — it is two strings and it currently misinforms about money. R1 should go
in before the owner opens the panel on anything narrower than 1440px.

## 8. What did NOT happen

- **Nothing was deployed.** No `ssh`, no service restart, no write of any kind to production.
- **Production was read only in the sense that it was not touched at all.** Every measurement
  ran against a local `nfc_demo`, re-seeded afterwards. `sh demo/check-guards.sh` → all 16
  refusals fire.
- **No iOS or Android file changed.** `git status` is empty for `NFCTimeSheets/`, `android/`,
  `ops/`, `server/` and `web/`. `project.pbxproj` untouched.
- **Nothing was committed by this review.** The two probes are untracked.
- **Nothing is left running** — no Node server on 8082/8083/8084, no headless Chrome. One was
  stranded on port 9600 by a throw in my own first probe run, killed, and the probe now has
  `uncaughtException` / `unhandledRejection` / `exit` handlers so a throw cannot repeat it.
- **This entire workstream is LOCAL.** Deploying it is the owner's call, not mine.
