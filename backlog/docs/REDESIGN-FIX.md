# Redesign: the fix pass

Fixes the findings of `backlog/docs/REDESIGN-A11Y.md` and `backlog/docs/REDESIGN-VISUAL.md`
against commit `b5c30fd`. Local only: production was never contacted, never deployed, never
restarted. Stack: `web/out` built from this tree, served same-origin by `server/server.js`
with `PUBLIC_DIR=../web/out` on `127.0.0.1:8082` against a re-seeded `nfc_demo`.
`sh demo/check-guards.sh` → `check-guards: OK` first; `nfc_demo` re-seeded afterwards
(6 workers / 6 objects / 341 shifts).

**One line:** a new Objekt can now be given a contract — step 2 of the `/locations/` drawer is
reachable again by mouse, Enter and Space, and pressing "Weiter" no longer saves the object
behind the operator's back. Everything else in here is contrast, phone layout, and moving
prose behind disclosure without deleting a word of it.

---

## 1. The one that lost data — C1

`web/app/locations/page.tsx` — two `key`s and an explicit focus move.

React reconciled the two ternary branches of the drawer footer as ONE `<button>` and reused
the node, patching `type="button"` → `type="submit"`. The browser resolves a click's
activation behaviour *after* React flushes, so one press of „Weiter zum Vertrag" advanced the
step **and** submitted the form: every new Objekt was created from step 1, with no contract.

Distinct `key="next"` / `key="save"` (plus `key="cancel"` / `key="back"`) make them two nodes.
Focus then has to be moved deliberately, because the node that was pressed no longer exists —
it goes to the step-2 CONTAINER (`tabIndex={-1}`), not to its first field: a text input is a
submit surface, so a second Enter half a second later would have created the object straight
through step 2 by implicit submission. That second hazard is real and was caught by
`demo/audit-keyboard.mjs` only after the first fix landed.

**RED first, then GREEN.** The keys were removed again, the tree rebuilt, and the check driven:

```
### MUTATION: the two footer primaries share one identity again (keys removed) ###
  FAIL locations: pressing "Weiter" does NOT save and close the drawer  — drawer=false
  ok   locations: the step really advances  — Schritt 1 von 2 · Objekt und Kunde → null   ← the old check, still green while saving
### RESTORED ###
  ok   locations: pressing "Weiter" does NOT save and close the drawer  — drawer=true
  ok   locations: the step really advances  — Schritt 1 von 2 · Objekt und Kunde → Schritt 2 von 2 · Vertrag und Zeit
  ok   locations: the step change is announced (step text in a live region)  — live=true
```

Real keyboard input, both keys, measured separately (`/tmp/probe-step-keys.mjs`, scratch):

```
Enter {"drawer":true,"step":"Schritt 2 von 2 · Vertrag und Zeit","focus":"INPUT text"}
Space {"drawer":true,"step":"Schritt 2 von 2 · Vertrag und Zeit","focus":"INPUT text"}
```

**The check that could not fail is fixed too.** `demo/audit-overlays2.mjs` drove this with
`el.click()`, which skips exactly the post-dispatch activation behaviour the bug lived in, and
printed `ok` throughout. It now uses `Input.dispatchMouseEvent` (`realClick`), asserts the
drawer is still OPEN after the press, and no longer accepts `step: null` as "the step
advanced" — `null !== "Schritt 1…"` was true precisely when the drawer had closed on a save.

Also fixed with it: **M2** — `web/components/Drawer.tsx` renders the step line as
`role="status"`, because the dialog's accessible name is the `<h2>` and does not change
between steps, so the crossing was announced to nobody.

---

## 2. Accessibility

| # | Fix | File |
|---|---|---|
| H2 | `--text-muted` **3.40–4.21 → 4.93–5.78:1** in both themes | `globals.css:34, 101` |
| H3 | `--border-strong` **1.52–1.62 → 3.21–3.34:1** (WCAG 1.4.11, control boundary) | `globals.css:37, 103` |
| H1 | `overflow-wrap: anywhere` → `break-word` on table cells | `globals.css` `.data-table th, td` |
| M5 | `#main-content` draws a ring when focus is moved into it programmatically | `.content:focus` |
| M1 | the five page-level `role="alert"` regions are permanently mounted, as `/shifts/` does | 5 page files |
| M3 | the phone 44px floor restated at CLASS specificity — it was losing to `.btn-quiet{32px}` and `select{36px}` | phone block |
| M4 | `.brand` 23 → 24px | `globals.css` |
| D1 | phone cards: a cell with two children no longer becomes two columns | phone block |
| D2 | phone action cells wrap instead of overflowing the screen | `.cell-actions` |

`node demo/audit-contrast.mjs`, 29 pairs × 2 themes: **14 failures → 4**, and the four are one
token, `--border`, discussed under "not fixed".

```
  ok     5.78:1  need 4.5:1  --text-muted on --bg-base        (was 3.98)
  ok     5.40:1  need 4.5:1  --text-muted on --bg-raised      (was 3.72)
  ok     4.93:1  need 4.5:1  --text-muted on --bg-overlay     (was 3.40)
  ok     3.28:1  need 3:1    --border-strong on --bg-base     (was 1.55)
  ok     3.34:1  need 3:1    --border-strong on --bg-raised   (was 1.62)
```

`node demo/audit-table-words.mjs` — the mid-word breaks are gone at 1440px:

```
  11/11 passed, 0 FAILED      (was 7/11: "STUN/DENS/ATZ", "Andre/a", "3.638,29" over two lines)
```

**H1 had a second-order cost and it was measured, not assumed.** With `break-word` the other
columns stop compressing, so an auto-layout table gives the difference to whichever column can
still break anywhere — the tag URI, whose min-content is one character. `/locations/` went
1864 → **2917px** on the first build: a seven-line URL ribbon. Two targeted rules bring it
back to **2011px** (+147 vs `b5c30fd`, still −40% vs the pre-redesign 3334):

- `.code-block { min-width: 24ch }` — a floor on the column, not a fixed width. This is the
  string a wall tag is written from.
- `.content` may use 100rem above 1500px. The 80rem cap was not protecting a line length —
  every prose block in the file carries its own 70/80ch cap — it was squeezing nine columns
  into 1280px and charging for it in row height.

`node demo/audit-phone.mjs` at 360px, both themes, 13 screens: no horizontal scroll, captions
still match their headings, and the only remaining sub-44px targets are the two deferred below.
Before this pass `/workers/` at 390px had **real** horizontal overflow —
`documentElement.scrollWidth 543` against a 390px layout width — with „Zugangscode erste…" cut
off at the viewport edge and nothing to scroll.

Unchanged and re-confirmed by driving: 5 overlays × 8 checks, keyboard-only worker creation
(13/13), focus restoration (`demo/probe-focus-restore.mjs` GREEN), focus rings 12/12 ≥3:1 in
both themes, German at 390px 9/9.

---

## 3. The load-bearing truths — re-shot after the fix, all intact

`node demo/shoot-truths.mjs`:

```
login-username-input: text / autocomplete=username / label="Benutzername"
drawer-nachtragen:   "Schicht nachtragen"   endRequired=true   submit="Schicht erfassen"
drawer-korrigieren:  "Schicht korrigieren"  endRequired=false  submit="Korrektur speichern"
enrolment-panel:     inModal=false inDrawer=false  "Gültig bis 22.08.2026, 19:27"
tag-uri:             https://schimmer-glanz.exe.xyz/t?l=5404d7b0-…  + "Tag-URL kopieren von …"
portal-chrome:       navLinks=0 themeSwitcher=0  h1="Aerztezentrum Landstrasse"
payroll:             "…ergeben genau die Summe des Servers … auf dieser Seite fehlt nichts."
                     "Nicht gezählt 1 · 1 zu bestätigen", per-row "1 zu bestätigen"
```

Deactivation stays soft. Nothing was deleted from `/payroll/`: the reconciliation sentence and
the counted, named exclusions are above the table and always visible.

---

## 4. Weight — the three screens that were SAME or HEAVIER

Nothing was cut. Prose moved behind disclosure or into the panel it belongs to.

| screen | b5c30fd → now | how |
|---|---|---|
| `/payroll/` 1680 | 1197 → **1047** (−13%) | `<details className="callout" open>` ships CLOSED. Same words, one click away, still under the table. |
| `/account/` 390 | 1087 → **1015** (−7%) | the four-line „kein Passwort vergessen" note is a `<details>` whose summary is „Passwort vergessen?" — the phrase a director hunts for, so folding it made it findable instead of merely present. |
| `/` dashboard 1680 | 1406 → **1391** | two loose grey footnotes moved INTO the heading of the panel they qualify (`ListPanel note`). A footnote floating between two panels is page-level prose and is ambiguous about which panel it describes. |

Everything else desktop is equal or lighter: `/material-requests/` −126, `/shifts/` −90,
`/pl/` −36, `/analytics/` −23, `/locations/` +147 (see H1 above).

On a phone: `/locations/` **−598**, `/material-requests/` −390, `/payroll/` −250,
`/account/` −72; `/shifts/` +1791 over 341 cards (+7%), `/inventory/` +109, `/workers/` +93,
`/pl/` +142 — that growth is the 44px touch floor and action buttons that now WRAP instead of
running off the screen. Content that used to be unreachable now occupies height. That is the
right trade and it is not reversible without giving the clipping back.

Evidence: `docs/media/redesign/after-fix/` (8 shots + `report.json`, same script and
configurations as the visual pass, so heights are comparable line for line).

---

## 5. Not fixed, and why

- **`--border` at 1.19–1.26:1** (4 of the 4 remaining contrast rows). It draws the table
  hairline and the panel edge — a decorative divider, not a control boundary, so WCAG 1.4.11
  does not cover it; the probe applies 3:1 to it anyway. Raising it to 3:1 would print a
  spreadsheet grid across every table in a design system whose first word is "flat". **D13**
  (light-theme cards barely separating on `#FAFAFA`) is the same token; the light base is
  specified by `docs/brand/prototype.html` and dark is the default.
- **`/account/` has no `role="alert"`** (`audit-overlays.mjs`, `audit-overlays2.mjs`, 1 FAIL
  each). Deliberate, with a comment: one permanently mounted `role="status"` carries both
  outcomes. REDESIGN-A11Y.md L4 records it as the probe being stricter than WCAG. Left alone
  on purpose, so the red is expected and named rather than silent.
- **`.brand` at 24px and the four in-sentence links at 38px** (`audit-phone.mjs`, 24 FAILs,
  all of them one of these two). 24×24 satisfies WCAG 2.5.8 AA; the links are inside
  sentences (`P.note`, `LI`), which 2.5.8 explicitly excepts. Making a header brand 44px tall
  would inflate the header on every screen to satisfy an AAA criterion.
- **D3 `/locations/` is over-columned at 1680px** (nine columns). The mid-word breaking is
  gone and the extra width helps, but nine columns is a content decision, not a CSS one.
- **D9 `/pl/` says „keine Zielmarge gesetzt" five times**, **D10 payroll's KPI mixes shifts
  and workers in one caption**, **D11 copy feedback lands far from the button**, **D12 the
  390px nav strip scrolls with no affordance**, **D4 `/analytics/` collides a button with a
  sentence** — copy and layout work, none of it load-bearing, all of it cheaper to do with the
  owner looking at the screen. Left in the visual pass's list.
- **L1/L2** (first focusable is the ✕; no `inert` on the shell behind an overlay) — both are
  conformant and already declared as ceilings in `web/lib/useOverlay.ts`.
- **The `AGENTS.md` tag-host drift** (`timesheets.exe.xyz` in the doc vs
  `schimmer-glanz.exe.xyz` rendered). Real, and out of scope here: `ops/` is off limits for
  this pass and `ops/branding.json` is the source of truth (decision-24).

## 6. Reproducing

⚠ The audit scripts below, and the two reports this pass fixes, are **untracked** in the
working tree — the verification passes wrote them and committed nothing. Only
`demo/audit-overlays2.mjs` is committed here, because this pass changed it. A `git clean`
would take the rest with it; whoever owns them should commit them.


```sh
sh demo/check-guards.sh
psql -q -d nfc_demo -f demo/seed.sql && DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
cd web && NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
cd server && DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8082 PUBLIC_DIR=../web/out node server.js &

node demo/audit-overlays2.mjs   # C1 + M1 + M2      1 FAIL: /account/ (deliberate, §5)
node demo/audit-keyboard.mjs    # 13/13
node demo/audit-contrast.mjs    # 4 FAIL: --border (deliberate, §5)
node demo/audit-table-words.mjs # 11/11
node demo/audit-phone.mjs       # 24 FAIL: .brand 24px + in-sentence links (deliberate, §5)
node demo/audit-german.mjs      # 9/9
node demo/audit-focus-ring.mjs  # 12/12
node demo/probe-focus-restore.mjs
node demo/shoot-truths.mjs
cd web && pnpm verify           # exit 0
```

`cd web && pnpm verify` → `All checks passed.` (24 checks) · biome `Checked 58 files … No
fixes applied.` · `tsc --noEmit` clean · `next build` ✓ · de/en **900/900**, no key on one
side only.
