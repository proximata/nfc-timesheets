# Redesign: accessibility and correctness pass

**Subject:** commit `b5c30fd` "the admin redesign lands: drawers, dark by default, one question
per screen" — the first time anything in it has been looked at. Its Verify/Fix/Demo/Review
agents all died with "Subagent produced no assistant output", so no screenshot had ever been
taken and no ratio had ever been computed before this run.

**Written 2026-08-17.** Local only. Production was not touched, not deployed, not restarted.
All measurements are against `web/out` built from the pristine `b5c30fd` tree and served by
`server/server.js` with `PUBLIC_DIR=../web/out` on `127.0.0.1:8082`, database `nfc_demo`
(6 workers, 3 clients, 341 shifts). `sh demo/check-guards.sh` → `check-guards: OK` first.

**Verdict in one line:** the overlay accessibility work is genuinely good and passes every
keyboard test put to it — and the redesign shipped one bug that means **nobody, mouse or
keyboard, can reach step 2 of the /locations/ drawer, so every new Objekt is created with no
contract**. That is C1 and it is the only thing in this document that is on fire.

---

## The scoreboard

| Area | Result |
|---|---|
| Overlay contract (5 overlays × 8 checks) | ✓ all pass |
| Keyboard-only worker creation, end to end | ✓ passes |
| Keyboard-only /locations/ creation | ✗ C1 — step 2 unreachable |
| Focus ring, 36 tab stops × 2 themes + inside a drawer | ✓ all ≥ 3:1, photographed |
| Contrast, 29 token pairs × 2 themes | ✗ 14 fail — H2, H3 |
| Table text at 1440px | ✗ 34 cells break words mid-character — H1 |
| German at 390px (clipping) | ✓ nothing clipped, 9 screens |
| Touch targets on a phone | ⚠ M3 — the 44px floor loses to two class rules |
| de/en parity, ICU args, bare literals, tsc, biome | ✓ 899/899, 0, 0, 0, 0 |
| Load-bearing truths (7) | ✓ all present — see §6 |

---

## 1. CRITICAL

### C1 · /locations/ step 2 is unreachable; one press of "Weiter zum Vertrag" saves the object

`web/app/locations/page.tsx:997-1019`

The drawer's footer renders two different primary buttons in the two branches of one ternary,
at the same JSX position:

```
997   footer={
998     step === 1 ? (
1003       <button type="button" className="btn btn-primary" onClick={goToContract}>
1004         {t('stepNext')}                                   // "Weiter zum Vertrag"
1012       <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
                {…t('submitCreate')}                            // "Objekt anlegen"
```

React reconciles those as the same `<button>` and **reuses the DOM node**, patching
`type="button"` → `type="submit" form={formId}`. The browser resolves a click's activation
behaviour *after* the React handler has flushed. So one click runs `goToContract()` → `setStep(2)`
→ React mutates the focused node into a submit button → the browser then submits `formId`.

Measured, real input events through `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`:

```
real mouse click on "Weiter zum Vertrag"
  {"tag":"opened","drawer":true,"step":"Schritt 1 von 2 · Objekt und Kunde"}
  {"tag":"after-real-mouse-click-on-weiter","drawer":false,"step":null}
  psql> select name,slug from locations where slug like 'mouse%'
        MOUSE Objekt|mouseobjekt1          ← created
        location_contracts for it: 0       ← step 2 never happened

real Enter on "Weiter zum Vertrag"   → identical: drawer:false, DBG Objekt created, 0 contracts
real Space on "Weiter zum Vertrag"   → identical: SPC Objekt created, 0 contracts
```

Root cause confirmed by the minimal fix, built and re-driven, then reverted:

```
patched: <button key="next" …onClick={goToContract}>  /  <button key="save" type="submit" …>
  mouse: {"tag":"after-real-mouse-click-on-weiter","drawer":true,"step":"Schritt 2 von 2 · Vertrag und Zeit"}
  Enter: {"tag":"after-enter-1","drawer":true,"step":"Schritt 2 von 2 · Vertrag und Zeit"}
```

Two distinct `key`s are the whole fix. `git diff --stat web/` is empty again — the tree is back
at `b5c30fd` and the four test objects were removed by re-seeding.

**C1b, which the fix exposes.** With the `key` fix in place, the same run reports:

```
{"tag":"after-enter-1","drawer":true,"step":"Schritt 2 von 2 · Vertrag und Zeit",
 "active":"BODY[] \"Zum Hauptinhalt springen…\" inOverlay=false"}
```

The old node is unmounted, so focus lands on `<body>`. Fixing C1 without also moving focus
into step 2 hands a keyboard user a dialog they are no longer inside. The fix task must do
both: distinct keys **and** an explicit focus move on step change (first field of step 2, or
the drawer container).

**Why no existing check caught it.** `demo/audit-overlays2.mjs` asserts exactly this and
reports it GREEN:

```
  ok   locations: the step really advances  — Schritt 1 von 2 · Objekt und Kunde → Schritt 2 von 2 · Vertrag und Zeit
```

It opens the step with `el.click()`. A programmatic `.click()` does not run the post-handler
activation behaviour that a real click does, so the synthetic path advances the step and the
real one saves. This is the fifth instance of the repo's recurring failure shape: **a check
whose negative case cannot fire**. Any future assertion about a button that changes identity
must use `Input.dispatchMouseEvent`.

---

## 2. HIGH

### H1 · `overflow-wrap: anywhere` crushes desktop table columns; German compounds and money break mid-character

`web/app/globals.css:576`

```css
.data-table th,
.data-table td {
  /* Long German compounds and long relay addresses break rather than overflow. */
  overflow-wrap: anywhere;
}
```

`anywhere` differs from `break-word` in one load-bearing way: it also collapses the cell's
**min-content** width to a single character, so `table-layout: auto` is free to squeeze a
column to four characters wide even at 1440px with room to spare. On screen, at 1440px:

```
NAME        →  "Andre / a / Steine / r"
STUNDENSATZ →  "STUN / DENS / ATZ"
15,50 €     →  "15,5 / 0 €"
```

`node demo/audit-table-words.mjs` (new; measures each cell's widest word with the cell's own
computed font against the width the cell actually got):

```
  FAIL 1440px /workers/    — 12 cells: "Stundensatz" needs 73px, cell gives 41px (col 3)
                                        "Andrea" needs 53px, cell gives 48px (col 0)
                                        "andrea@example.test" needs 148px, cell gives 95px
  FAIL 1440px /locations/  — 18 cells: "Ansprechperson" needs 95px, cell gives 69px (col 2)
                                        "Status" needs 37px, cell gives 20px (col 6)
  FAIL 1440px /pl/         —  1 cell:  "3.638,29" needs 65px, cell gives 64px (col 3)
  FAIL 1440px /analytics/  —  3 cells: "Ordinationszentrum" needs 147px, cell gives 131px
  7/11 passed, 4 FAILED
```

Note `3.638,29` breaking across two lines: that defeats the `tabular-nums` the design system
exists to get right, on the profit-and-loss screen.

**Fix proven both directions.** Overriding only that one declaration in the shipped CSS:

```
=== MUTATION: overflow-wrap: break-word instead of anywhere ===
  ok 1440px /shifts/ /workers/ /locations/ /clients/ /contracts/ /inventory/ /payroll/ /pl/
     /analytics/ /material-requests/  — 910 text cells, none broken
  11/11 passed, 0 FAILED
=== RESTORED (shipped CSS) ===
  7/11 passed, 4 FAILED
```

`globals.css:1126` (`.tag-uuid`) must KEEP `anywhere` — a UUID has no words and wrapping it
is the documented intent, and `audit-table-words.mjs` skips it for that reason.

⚠ **Open question the fix task must close.** With `break-word`, `demo/audit-phone.mjs` flips
to `h-scroll +183px` on `/workers/` at 360px. Re-measuring that viewport directly gives
`.app-shell` 360, `.content` 360, table 334 with `scrollWidth 613` inside its own scroll
container, and `documentElement.scrollWidth === window.innerWidth` — i.e. no sideways scroll.
The +183 is `Emulation.setDeviceMetricsOverride` with `mobile: true` applying shrink-to-fit and
the probe comparing `scrollWidth` against `clientWidth` across that scale (see P3). **Do not
take that FAIL at face value and do not take this paragraph as a clean bill either**: measure
the fix in a real 360px-wide window before closing it.

### H2 · `--text-muted` fails 4.5:1 in BOTH themes, on all three surfaces

`web/app/globals.css:34` (dark `#6c7178`), `web/app/globals.css:101` (light `#767c85`)

`node demo/audit-contrast.mjs` — resolves each token through Chrome's own colour engine
(`ctx.fillStyle` + `getImageData`, alpha composited, never divided out):

| pair | dark | light | need |
|---|---|---|---|
| `--text-muted` on `--bg-base` | **3.98:1** | **4.03:1** | 4.5 |
| `--text-muted` on `--bg-raised` | **3.72:1** | **4.21:1** | 4.5 |
| `--text-muted` on `--bg-overlay` | **3.40:1** | **4.21:1** | 4.5 |

This is not a corner token. It carries `.cell-muted`, `.tag-uuid`, `.empty-state`,
`.brand-suffix`, `.app-footer`, `.field .opt`, the `.step` line above every drawer title and
the `thead` labels of every data table — 20 `color: var(--text-muted)` sites in `globals.css`.
The `thead` case is the worst: the column headings of every table are below 4.5:1 in both
themes, and on a phone the column heading is the only thing that says what a card's value
means.

`--text-secondary` is fine (8.69 / 7.79 and better), so the cheap fix is to darken/lighten
`--text-muted` until it clears 4.5:1 on `--bg-overlay`, the tightest of the three.

### H3 · Every border in the system is below the 3:1 required for a UI component boundary

`globals.css:36-37` (dark), `globals.css:102-103` (light) — WCAG 1.4.11 Non-text Contrast

| token | dark on base / raised | light on base / raised | need |
|---|---|---|---|
| `--border` | **1.19 / 1.23** | **1.26 / 1.26** | 3 |
| `--border-strong` | **1.55 / 1.62** | **1.52 / 1.53** | 3 |

`--border` on a table hairline is arguably decorative. `--border-strong` is not:

- `globals.css:464` — `.field input, .field select, .field textarea { border: 1px solid var(--border-strong) }`.
  This is the boundary of every form control in every drawer. Worse inside a drawer: the input
  is filled with `--bg-base` on a `--bg-overlay` surface, so the *only* two cues that "this is
  where you type" are a 1.55:1 border and a 1.35:1 fill difference.
- `globals.css:270` — the locale and theme `<select>` in the header.
- `globals.css:366` — `.btn-ghost` outline, i.e. the Cancel button in every drawer footer.

The focus ring itself is fine (`--focus` = `--accent`: 7.77 dark / 4.64 light), so this only
bites the *unfocused* resting state — which is the state a person is in while looking for the
field.

**The contrast probe is not vacuous.** Overriding the shipped token in the built stylesheet:

```
=== MUTATED CSS: --text-primary := #0c0d0f (≈ --bg-base #0b0c0e) ===
  FAIL   1.01:1  need 4.5:1  --text-primary on --bg-base
  FAIL   1.06:1  need 4.5:1  --text-primary on --bg-raised
=== RESTORED ===
  ok    16.26:1  need 4.5:1  --text-primary on --bg-base
  ok    15.18:1  need 4.5:1  --text-primary on --bg-raised
```

It reads the value the browser actually paints, and a passing row can be made to fail.

---

## 3. MEDIUM

### M1 · The `role="alert"` region is conditionally mounted on 6 screens, contradicting the comment above it

The pattern `/shifts/` uses is correct — a permanently mounted, empty-when-idle region
(`web/app/shifts/page.tsx:604`). Six screens carry the same explanatory comment and then do
the opposite:

| file:line | shape |
|---|---|
| `web/app/clients/page.tsx:415` | `{loadError !== null ? <p role="alert">…</p> : null}` |
| `web/app/contracts/page.tsx:354` | same |
| `web/app/inventory/page.tsx:237` | same |
| `web/app/material-requests/page.tsx:383` | same |
| `web/app/page.tsx:312` | same |
| `web/app/account/page.tsx:127` | no `role="alert"` at all — see L4 |

`web/app/clients/page.tsx:412-413` states the rule it then breaks:

> Permanent live regions: a text change inside an existing region is announced far more
> reliably than a node that appears and disappears.

Measured (`demo/audit-overlays2.mjs`, idle state, every screen):

```
  ok   /shifts/    — alert=1 liveRegions=3 emptyOnes=2
  FAIL /           — alert=0 liveRegions=1 emptyOnes=0
  FAIL /material-requests/ /clients/ /contracts/ /inventory/ /account/  — alert=0
```

Not a hard AA failure (an inserted `role="alert"` is announced by most SR/browser pairs), but
it is the exact inconsistency the codebase wrote a comment to prevent, and the `role="status"`
sibling on those same pages IS permanently mounted — so the two halves of one pattern disagree
inside one file.

### M2 · The /locations/ drawer's step change is announced to nobody

`web/app/locations/page.tsx:995` passes `step={step === 1 ? t('stepOne') : t('stepTwo')}`;
`web/components/Drawer.tsx:58-61` renders it as a plain `<p className="step">`. The dialog's
accessible name comes from the `<h2>`, which does not change between steps.

```
  FAIL locations: the step change is announced (step text in a live region)
       — live=false dialogName="Objekt anlegen"
```

So a screen-reader user who crosses from step 1 to step 2 hears nothing at all: same dialog
name, no live region, and (after C1b) focus on `<body>`. Fix alongside C1: put the step line in
`role="status"`, or fold the step into the dialog's accessible name.

### M3 · The phone 44px touch-target floor is overridden by two class rules — and the comment says it cannot be

`web/app/globals.css:1593-1603`:

```css
  /* Touch targets. 44px is the floor, not the aspiration.
     biome-ignore-start lint/style/noDescendingSpecificity: bare element selectors after the
     class-scoped ones is the point — … min-height is the only property it sets, so nothing
     above it is overridden. */
  .nav-link, button, .button, input, select, textarea { min-height: 44px; }
```

A bare `button` (specificity 0,0,1) loses to a class (0,1,0), media query or not. Two rules
above it win:

- `web/app/globals.css:380` — `.btn-quiet { min-height: 32px }`. These are the row actions:
  *Bearbeiten*, *Deaktivieren*, *Zugangscode erstellen*, *Korrigieren* — the most numerous
  buttons on every screen.
- `web/app/globals.css:268` — `.locale-switcher select, .theme-switcher select { min-height: 36px }`.

Measured at 360px, both themes, every screen (`demo/audit-phone.mjs`):

```
  FAIL dark 360 /workers/ — <44px: A.skip-link h=41, A.brand h=23, SELECT. h=36, SELECT. h=36,
                                   BUTTON.btn h=35, BUTTON.btn h=35
```

Honest grading: 35px and 36px **pass** WCAG 2.5.8 Target Size (Minimum, AA, 24×24) and fail
2.5.5 (AAA, 44×44). So this is not an AA violation — it is the design system failing its own
stated floor, silently, with a comment asserting that it cannot. `.nav-link` has the same
specificity as the floor rule and comes earlier in the file, so it does get 44px; that is why
this looks like it works.

### M4 · `.brand` is 23px tall — one pixel under WCAG 2.5.8 AA

`web/components/AppShell.tsx:39-42`, styled at `web/app/globals.css:233-241`. Measured
`A.brand h=23` at 360px. It is a link home in the header, not an inline link inside a
sentence, so the 2.5.8 inline exception does not apply. One `min-height` or a little padding.

### M5 · `#main-content` takes focus with the outline switched off

`web/app/globals.css:282-284` — `.content:focus { outline: none }`, and `#main-content` is
`.content` (`web/components/AppShell.tsx:56`).

That is defensible for the skip link, which is accompanied by a visible scroll. It is not
defensible for `web/lib/useOverlay.ts:145` — the documented fallback when the control that
opened an overlay was removed by the save:

```
      if (opener?.isConnected) opener.focus()
      else document.getElementById('main-content')?.focus()
```

A sighted keyboard user whose row disappeared gets focus moved to a container that draws
nothing. Verified reachable: `demo/audit-overlays2.mjs` drives the resolve-an-unresolved-shift
path and lands there. `:focus-visible` would not fire for the programmatic move either, so a
`.content:focus { outline: 2px solid var(--accent); outline-offset: -2px }` (or an equivalent)
is the smallest honest fix.

---

## 4. LOW / informational

- **L1** `web/lib/useOverlay.ts:80-82` focuses the *first* focusable descendant, which is the
  header's `✕ Schließen` in every drawer. Measured on all five overlays: `focus moves into the
  drawer — BUTTON "✕Schließen"`. Conformant, and one Tab away from useful. Focusing the first
  *field* (or the dialog itself) would be kinder; keep the ✕ first in DOM order regardless.
- **L2** No `inert` on `.app-shell` while an overlay is open. Already declared as a deliberate
  ceiling in `web/lib/useOverlay.ts:33-37` with the upgrade path. A screen reader in browse
  mode can still read the page behind. Leave it until someone hits it.
- **L3** The enrolment code panel sits **above** the table, not beside the worker's row
  (`/tmp/ts-audit/enrol-after.png`). It names its worker explicitly — *"Zugangscode für Andrea
  Steiner:"* — so the read-it-aloud-while-looking-at-the-name use case survives. It is not a
  modal, which is the part that mattered. Minor deviation from the brief's wording; no action
  proposed.
- **L4** `web/app/account/page.tsx:124-133` announces a failed password change through a
  permanently mounted `role="status" aria-live="polite"`, with a comment explaining the choice.
  A failed submit is arguably `assertive`. My probe asserts `role="alert"` specifically and so
  reports `/account/` as a failure; that is the probe being stricter than WCAG, recorded here
  so nobody "fixes" a deliberate decision.
- **L5** The scrim is `<button aria-hidden="true" tabIndex={-1}>` (`web/components/Drawer.tsx:47`).
  `aria-hidden` on a *focusable* element is a smell, but axe's `aria-hidden-focus` rule only
  fires for *tabbable* elements, and `tabIndex={-1}` keeps it out. No action.
- **L6** If the explicit `outline: 2px solid var(--accent)` at `globals.css:174` were ever
  dropped, `.btn-primary` would fall back to `currentColor` = `--accent-text`, measured at
  **1.04:1** against the page. Surfaced by mutation A below. The rule is load-bearing; leave a
  note, not a change.

---

## 5. The focus-restoration mutation test — RED then GREEN

`demo/probe-focus-restore.mjs` (new, ~4 s). One assertion, and it cannot pass vacuously: it
fails if the opener is not found, if the overlay never opened, if focus was already outside the
trap before Escape, if Escape did not close it, or if `document.activeElement` is anything
other than the node captured *before* the click. It Tabs twice inside the drawer first, so a
"restoration" that is really "focus never moved" cannot pass.

**Baseline, pristine `b5c30fd`:**

```
$ node demo/probe-focus-restore.mjs
  ok   focus returned to the opener — BUTTON "Mitarbeiter anlegen"
GREEN
EXIT=0
```

**Mutation — restoration deliberately removed from `web/lib/useOverlay.ts:143-145`:**

```
-      // `isConnected` is the whole reason this hook exists — see the header comment.
-      if (opener?.isConnected) opener.focus()
-      else document.getElementById('main-content')?.focus()
+      // MUTATION (a11y audit, scratch only): restoration deliberately removed.
+      void opener
```

```
$ cd web && pnpm build            # 8.0 s, exit 0
$ node demo/probe-focus-restore.mjs
### MUTATION: focus restoration removed from web/lib/useOverlay.ts ###
  FAIL focus restoration — focus landed on BODY "Zum Hauptinhalt springenNFC TimeSheetsAdminDarst" instead of the opener
RED
EXIT=1
```

**Restored:**

```
$ cp /tmp/useOverlay.ts.orig web/lib/useOverlay.ts && git diff --stat web/lib/useOverlay.ts
(empty — identical to HEAD)
$ cd web && pnpm build && cd .. && node demo/probe-focus-restore.mjs
### RESTORED ###
  ok   focus returned to the opener — BUTTON "Mitarbeiter anlegen"
GREEN
EXIT=0
```

Three more probes were broken on purpose and shown red before being trusted:

| probe | mutation | result |
|---|---|---|
| `audit-contrast.mjs` | `--text-primary := #0c0d0f` in the built CSS | 16.26:1 → **1.01:1 FAIL**, restored → ok |
| `audit-focus-ring.mjs` | A: `:focus-visible { outline: none }` | every stop **FAIL**, restored → ok |
| `audit-focus-ring.mjs` | B: `outline-color := var(--bg-base)` | 7.77:1 → **1:1 FAIL**, restored → ok |
| `audit-german.mjs` | `.btn { max-width: 60px; overflow: hidden }` below 768px | 9/9 → **0/9 FAILED**, restored → 9/9 |
| `audit-table-words.mjs` | `overflow-wrap: break-word` | 4 FAILED → **0 FAILED**, restored → 4 FAILED |

---

## 6. What passes — measured, not assumed

### The overlay contract

`node demo/audit-overlays.mjs` — real `Input.dispatchKeyEvent` throughout; a focus trap tested
with synthetic Tabs passes even when it does not trap.

```
  ok   skip link is the first tab stop  — A "Zum Hauptinhalt springen"
  ok   skip link moves focus to #main-content  — MAIN#main-content
```

Five overlays × eight checks, all ok: **shifts:correct**, **shifts:create**, **workers:edit**,
**workers:deactivate-confirm** (modal), **locations:create**. For each: focus moves in;
`role=dialog aria-modal=true` with a resolvable accessible name; body scroll locked; Tab
trapped over *focusables + 3* presses; Shift+Tab trapped; Escape closes; focus restored to the
opener; scroll released. Example:

```
  ok   shifts:correct: role=dialog aria-modal + accessible name  — role=dialog modal=true name="Schicht korrigieren"
  ok   shifts:correct: Tab is trapped (7 focusables, 10 presses)
  ok   shifts:correct: Shift+Tab is trapped
  ok   shifts:correct: focus restored to the opener  — KorrigierenElif DemirOrdination Gumpendorf…
```

Edge cases from `audit-overlays2.mjs`, all ok:

```
  ok   locations: failed step-1 submit sets aria-invalid + a resolvable aria-describedby
       — [{"text":["Bitte einen Objektnamen eingeben."]},{"text":[…,"Bitte ein Kurzkürzel eingeben."]}]
  ok   Escape closes the drawer even from a native <select>
  ok   shifts: aria-busy="true" on the table while the write is in flight
  ok   shifts: focus is NOT dumped on <body> after the save closed the drawer
  ok   shifts: focus landed inside #main-content (useOverlay fallback)
```

No `ConfirmModal` is rendered inside a `Drawer` anywhere (all five are page-level siblings
declared after the drawer), so `useOverlay`'s overlay *stack* — the part that stops one Escape
closing two overlays — has no caller exercising it today. It is correct by reading; it is
untested by driving, and that is worth knowing before someone nests one.

### Keyboard only, no pointer

`node demo/audit-keyboard.mjs` — no `.click()`, no `.focus()`; if a control cannot be reached
by Tab the journey fails.

```
  ok   login: the username field has focus on load (autoFocus)  — INPUT[type=text]
  ok   login: Enter in the password field submits the form
  ok   workers: "Mitarbeiter anlegen" is reachable by Tab  — 18 press(es)
  ok   workers: Enter on the opener opens the drawer
  ok   workers: the first field is reachable by Tab inside the drawer
  ok   workers: the submit button is reachable by Tab  — Mitarbeiter anlegen
  ok   workers: Enter on submit saves and closes the drawer
  ok   workers: the new worker appears in the list  — KB Prüfer 655018
  ok   workers: the outcome is announced in a page-level live region  — ["Mitarbeiter gespeichert."]
```

A whole write journey completes with the keyboard alone. 18 Tab presses to reach the page's
primary action is a lot — the skip link exists and works, so it is a density note rather than
an a11y defect.

The /locations/ equivalent is C1.

### Focus visibility

`node demo/audit-focus-ring.mjs` — 36 tab stops per theme on `/workers/`, plus 14 stops inside
the drawer, measuring the ring against the nearest ancestor that actually paints (the ring is
drawn *outside* the element at `outline-offset`, so scoring it against the element's own
background scores the wrong pair).

```
=== dark ===   every tab stop >=2px at >=3:1     nav links 7.91:1   drawer inputs 7.26:1
=== light ===  every tab stop >=2px at >=3:1     nav links 4.32:1   drawer inputs 4.84:1
12/12 passed
```

Photographs: `/tmp/ts-audit/focus/*.png` — six page controls and three drawer fields per theme,
cropped with ffmpeg out of a full-viewport frame.

**This probe lied once and was made to stop.** Its first version cropped with
`Page.captureScreenshot({ clip })`, whose clip is in *page* coordinates while
`getBoundingClientRect()` is in *viewport* coordinates. Tab scrolls the page, and the drawer is
`position: fixed`, so every drawer crop was a rectangle of flat `#0b0c0e` — reported at
7.26:1 with a picture of nothing. It now crops from a full-viewport frame and then **scans the
crop for the ring's own colour**, failing if it is absent:

```
       shot /tmp/ts-audit/focus/dark-drawer-0-input.png  ring 7.26:1  ring pixels in the crop: 5.62%
  ok   dark: the drawer ring is actually IN every crop  — 3 crop(s)
```

### German at 390px

`node demo/audit-german.mjs` — per-element clipping (`scrollWidth > clientWidth` where computed
overflow is not `visible`), which is the condition under which text becomes unreachable with no
scrollbar anywhere to hint at it. `Objekt`, `Kunde`, `Zugangscode`, `Schicht nachtragen`,
`Auswertung`, `Lohnabrechnung`, `Materialanforderung`, `Deaktivieren`, `Stundensatz`, `Gewinn`.
It fails if a screen renders none of the words it was told to look for.

```
9/9 passed, 0 FAILED     screenshots: /tmp/ts-audit/german
```

`<html lang="de-AT">` — correct, and the first version of the check asserted a bare `de` and
failed all nine screens for it.

`demo/audit-phone.mjs` at 360px, both themes, 13 screens: **no horizontal scroll**, sidebar
strip present with all 12 links, and — the check that shipped wrong once before — every phone
card caption matches its column heading position for position. The only failures are the touch
targets of M3.

### The load-bearing truths

| Truth | Verified |
|---|---|
| `/login/` is `type="text"` `autoComplete="username"` | ✓ `web/app/login/page.tsx:92-93`, plus `autoFocus` with a `biome-ignore` at :96-97. The client is not locked out. |
| `/shifts/` has TWO drawers, not one behind a mode flag | ✓ names read off the live DOM: `"Schicht korrigieren"` and `"Schicht nachtragen"`, separate openers, separate overlays |
| `/payroll/` reconciliation line | ✓ *"Die hier geladenen Schichten ergeben genau die Summe des Servers für denselben Zeitraum – auf dieser Seite fehlt nichts."* |
| `/payroll/` names its exclusions | ✓ a `NICHT GEZÄHLT` column; `excludedUnresolved` / `excludedOpen` / `excludedNoRate`; answer band *"Keine Schicht offen oder unbestätigt · 2 Mitarbeiter ohne Stundensatz"* |
| a worker with no rate is an EXPLICIT exclusion, never a silent 0,00 | ✓ **tested by setting a rate to 0 in `nfc_demo`**: row renders `Elif Demir  49,00  Kein Stundensatz  Nicht bewertet  Kein Stundensatz`; the string `0,00` appears nowhere on the page. `workers.hourly_rate_cents` is `NOT NULL DEFAULT 0`, so `=== 0` at `web/app/payroll/page.tsx:161` is the complete test. Re-seeded afterwards. |
| `/locations/` surfaces and one-click copies the tag URL | ✓ `https://schimmer-glanz.exe.xyz/t?l=89790dcd-d541-42da-86a6-c8157752e140` rendered in full, with `Tag-URL kopieren von <Objekt>` per row |
| `/workers/` enrolment code is an inline panel, never a modal, with its expiry at copy time | ✓ the modal is only the *confirmation* (`"Neuen Zugangscode für Andrea Steiner erstellen?"`); after confirming, `.code` `6248-V5M5` renders outside any `.modal` with *"Gültig bis 22.08.2026, 18:02"* and a copy button. See L3 on placement. |
| deactivation is soft | ✓ `web/lib/api.ts:235-247, 368, 676-687` — `DELETE` routes documented as soft, revoking grants rather than destroying rows |
| `/reinigung/` is the public portal with no admin chrome | ✓ `appShell:false sidebar:false themeSwitcher:false localeSwitcher:false logout:false linksIntoAdmin:[] h1:"Reinigungsnachweis"`, its own `<main>` |

⚠ **Documentation drift, not a code defect.** The tag host rendered is
`schimmer-glanz.exe.xyz`, while `AGENTS.md` still records decision-15 as *"Tag hostname stays
`timesheets.exe.xyz`"* and lists the associated domain as `applinks:timesheets.exe.xyz`. One of
the two is stale. `ops/branding.json` is the source of truth per decision-24; someone should
run `node ops/check-branding.mjs` and correct `AGENTS.md`, because a wrong host in the
onboarding doc is a wall tag written wrong.

### The tree, independently re-checked

```
$ pnpm tsc --noEmit         → 0 errors
$ pnpm biome check .        → Checked 58 files in 60ms. No fixes applied.
$ pnpm check               → All checks passed. (24 checks)
de keys 899  en keys 899   de-only []  en-only []
bare JSX literals: 0 candidates after filtering (1 hit, inside a JS expression)
```

**The brief's premise about `scripts/check.mjs` is wrong.** It does *not* use "a naive
placeholder regex that cannot see arguments nested inside ICU plurals". It already loads
`@formatjs/icu-messageformat-parser` out of the pnpm store
(`web/scripts/check.mjs:69-79`), walks the AST (`argumentsOf`, :85-98), and carries its own
self-tests for exactly the nested case:

```js
assert.deepEqual([...argumentsOf('{count, plural, one {# Punkt für {names}} other {# Punkte}}')].sort(),
  …, 'arguments nested inside a plural branch must be seen')
```

It also enforces something stronger that nobody asked for: every *tallied* `{count}` must
select a plural form, so `"1 Schichten angezeigt."` cannot ship. No work needed here. Recorded
because a stale premise in a brief is how a real check gets rewritten into a worse one.

---

## 7. Fix list, in the order that matters

| # | What | Where | Effort |
|---|---|---|---|
| 1 | C1 — distinct `key` on the two footer primaries **and** an explicit focus move into step 2 | `web/app/locations/page.tsx:997-1019` | low |
| 2 | M2 — put the drawer step line in a live region (same commit as 1) | `web/components/Drawer.tsx:58-61` | low |
| 3 | H1 — `overflow-wrap: break-word`, keep `anywhere` on `.tag-uuid`; re-measure 360px in a real window | `web/app/globals.css:576` | low |
| 4 | H2 — retune `--text-muted` to clear 4.5:1 on `--bg-overlay` in both themes | `web/app/globals.css:34, 101` | low |
| 5 | H3 — raise `--border-strong` to ≥3:1, at least where it draws a control boundary | `web/app/globals.css:37, 103, 464, 270, 366` | med (touches every control's resting look) |
| 6 | M5 — give `#main-content` a visible ring when focus is moved into it programmatically | `web/app/globals.css:282-284` | low |
| 7 | M1 — mount the six `role="alert"` regions permanently, as `/shifts/` does | 6 files, §3 | low |
| 8 | M3/M4 — make the phone touch floor win (class-level selectors), or accept 24px AA and delete the comment that claims otherwise | `web/app/globals.css:1593-1603, 380, 268, 233` | low |
| 9 | Replace `el.click()` with `Input.dispatchMouseEvent` in `demo/audit-overlays2.mjs` so C1's shape cannot go green again | `demo/audit-overlays2.mjs:126` | low |

Nothing above is implemented. This was a look, not a build; the working tree is identical to
`b5c30fd` (`git diff --stat web/` empty) and `nfc_demo` has been re-seeded to its documented
contents.

---

## 8. Reproducing this

```sh
sh demo/check-guards.sh
psql -q -d nfc_demo -f demo/seed.sql
DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
cd web && NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
cd server && DATABASE_URL=postgres:///nfc_demo \
  APP_KEY=tsk_9880d49f83794967790deb8a2c8f3dd46633cc78104c2f65 \
  PORT=8082 PUBLIC_DIR=../web/out node server.js & cd ..

node demo/audit-contrast.mjs        # 29 pairs × 2 themes            exit 1 today
node demo/audit-overlays.mjs        # 5 overlays × 8 + 12 screens    exit 1 today (M1, M2)
node demo/audit-overlays2.mjs       # overlay edge cases             exit 1 today (M1, M2)
node demo/audit-keyboard.mjs        # keyboard-only write journeys   exit 0
node demo/probe-focus-restore.mjs   # the one mutation-tested probe  exit 0
node demo/audit-focus-ring.mjs      # rings, measured + photographed exit 0
node demo/audit-german.mjs          # 390px clipping                 exit 0
node demo/audit-table-words.mjs     # 1440px mid-word breaks         exit 1 today (H1)
node demo/audit-phone.mjs           # 360px, both themes, 13 screens exit 1 today (M3)
```

Every one of these passes `port:` to `launchChrome` explicitly (9401-9409). `launchChrome`'s
poll of `/json/version` succeeds against *any* Chrome already on its default 9333, silently
adopts it, and then wipes its profile directory out from under it — which is the shape of the
"headless Chrome at 0% CPU for 49 minutes" this repo has already paid for. Twenty-one orphaned
Chrome processes from earlier failed runs were sitting on 9333 and 9351 when this audit started
and were killed by user-data-dir match (`/tmp/ts-demo/chrome-profile-*`) before anything else
happened.
