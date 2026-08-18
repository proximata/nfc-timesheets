# IA round: accessibility and correctness pass

**Subject:** `37081ea` (every cross-link carries its filter) and `a4a5b17` (the map is the
landing surface) — the query-parameter object surface of decision-38 and the map region of
decision-39. Neither has been looked at by anything but its own build.

**Written 2026-08-18.** Local only. Production untouched, not deployed, not restarted.
`sh demo/check-guards.sh` → `check-guards: OK` first. Everything below is measured against
`web/out` built from the pristine `a4a5b17` tree, served on `127.0.0.1:8080` — the port is
part of the fixture, because the Maps browser key is referrer-restricted to it and on any
other port Google answers `gm_authFailure`, the map tears itself down, and every assertion
about a drawn map passes by never running. Database `nfc_demo`, 6 buildings (5 pinned, 1
never geocoded), 6 workers, 351 shifts.

**Verdict in one line:** the object surface is correct — 15 hand-mangled values × every
parameter × every screen never once showed another object's data — and the two things that
are wrong are both **focus**: closing a URL-driven panel drops the keyboard user on `<body>`,
and the map's info box is the one surface in the admin that ignores Escape.

---

## The scoreboard

| Area | Result |
|---|---|
| Overlay contract, button-opened (5 overlays × 8) | ✓ 55/56, 24/25 — the 1 is pre-existing `/account/` |
| Overlay contract, **URL-opened panels** | ✗ **F1** — Escape leaves focus on `<body>` |
| Objektpanel drawer + phone bottom sheet | ✓ 8/8 and 8/8 |
| Map info box | ✗ **F2** — no Escape, focus never follows the opener |
| Keyboard reaches everything the pins do | ✓ set equality, 6 buildings — with a caveat, below |
| Contrast, 42 tokens × 2 themes, over our surfaces | ✗ 4 pre-existing `--border` hairlines |
| Contrast, pins + box over the muted map, 2 themes | ✗ **F3** — 2 real of 18 flagged; 16 triaged out |
| Colour as the SECOND signal (greyscale) | ✓ PASS — every state carries its own word |
| Horizontal overflow, 11 widths × 19 states | ✓ 223/223, including the probe's own sabotage |
| ICU, parsed AST, de/en, every plural | ✓ 17/17 — after closing a hole in the check |
| URL parameters, 15 mangles × 26 param/screen pairs | ✗ **F4** — 1 of 60, uppercase UUID |

Queued, not built: **TASK-171** (F1) · **TASK-172** (F2) · **TASK-173** (F3) · **TASK-174** (F4).
Nothing in `web/app`, `web/components` or `web/lib` was changed by this run. `android/`,
`NFCTimeSheets/` and `project.pbxproj` were not opened.

---

## F1 — closing a URL-driven panel dumps focus on `<body>`

The defect the whole of `lib/useOverlay.ts` was written to prevent, on the panels decision-38
introduced. `demo/probe-focus-restore.mjs`, three openers, same build, same session:

```
/workers/  'Mitarbeiter anlegen'      <button>            GREEN  focus → the opener
/shifts/   'Mitarbeiterpanel öffnen'  <a href="?worker=">  RED   focus → BODY
/payroll/  'Mitarbeiterpanel öffnen'  <a href="?worker=">  RED   focus → BODY
```

```
focusIn=true  escClosed=true  restored=false  landed=BODY  openerConnected=false
```

**Cause, established rather than guessed.** `useOverlay` restores in the effect cleanup:

```ts
if (opener?.isConnected) opener.focus()
else document.getElementById('main-content')?.focus()
```

For a URL-driven panel the close itself re-renders the list that holds the opener anchor. At
cleanup time the anchor is *still connected*, so `.focus()` succeeds — and React then replaces
that node in the same commit, at which point the browser drops focus to `<body>`. The
`isConnected` guard is checked at the wrong moment for this shape of close. It was written for
"the save removed the row", where the removal lands in an earlier commit and the guard is
already false by cleanup time.

Not the App Router: `lib/filters.ts` uses raw `pushState`/`replaceState` on purpose, and the
static export has no `useSearchParams`. Nothing here argues with decision-38.

**Cost to the reader.** On `/shifts/` — 351 rows — Escape returns you to the top of the
document. The place you were reading is somewhere below, reachable only by re-tabbing.

**The probe was mutation-tested, and the RED came first.** `useOverlay`'s two restoration
lines were deleted, `pnpm build` re-run, and the GREEN case above went RED with the same
message the link cases produce. Reverted, rebuilt, GREEN again; `git status --short web/` clean.

```
mutation: restoration deleted → /workers/  RED   focus landed on BODY
reverted                      → /workers/  GREEN focus returned to the opener
```

**One fix to the probe, and it is why F1 was invisible until now.** It waited a fixed 400 ms
for the overlay. A `<button>` mounts a drawer in the same tick; a link has to round-trip
through history and a state read first — measured at ~1.4 s. At 400 ms every link case
reported *"the overlay never opened"*, which reads as a probe limitation, gets ignored, and
leaves the panel whose focus handling is actually broken unmeasured. Now a bounded 6 s wait.

---

## F2 — the map info box takes no Escape, and focus never follows the control that opened it

`demo/audit-map-a11y.mjs`, 28/32. All four failures are this one box.

```
FAIL map info box: focus moves INTO it            focus stayed on the Objektliste button
FAIL map info box: Tab is trapped                 escaped at press 1
FAIL map info box: Escape closes it
FAIL info box: reachable by Tab FORWARD from its own opener   not reached in 30 presses
ok   info box: reachable at all with Shift+Tab    7 presses, 6 of them Google's controls
ok   info box: the cross-links really are inside it           11 links
```

### Does the map pass? Plainly: the map is mouse-only by design, and the design holds — except here

The pins are `aria-hidden` + `tabIndex={-1}`, stated as a ceiling in `HomeMap.tsx` rather than
left as an oversight. The Objektliste is the keyboard path, and it is a **complete** one:

```
Ordination Gumpendorf        11 links, identical to the pin's
Aerztezentrum Landstrasse     8 links, identical
Buerozentrum Handelskai       8 links, identical
Wohnhaus Wagramer Strasse     8 links, identical
Wohnhausanlage Donaufeld      8 links, identical
Studiohaus Neubaugasse       (no pin) 6 links — the whole object surface anyway
```

**What that parity check does and does not prove, because the label overclaims.** On desktop
both paths converge on the *same DOM node* — `viaList` and `viaPin` each read `.map-info`. So
it proves the row and the pin open the **same building's** surface, which catches an id
mix-up and is worth having. It cannot prove reachability, and sections 2 and 3 show the links
are not forward-reachable from the control that opened them.

**Arriving from a cross-screen link is fine.** `/locations/` and `/pl/` point their
"Objektpanel öffnen" at `/?location=<uuid>` — a navigation to the landing screen, not an
in-place panel — and it lands correctly with the right building's box open. Measured Tab
distance on the fresh document:

```
with the skip link      5 Tabs   Aktualisieren → ✕Filter → Kurzbefehle → Karte → ✕Infobox
without it             20 Tabs   the whole shell first
```

So: **no function is keyboard-inaccessible.** This is not a WCAG 2.1.1 failure and not a 2.1.2
trap — focus *can* leave, backwards. What is broken is that the box is the only surface in the
admin that does not keep the contract every `Drawer` and `Modal` keeps. A keyboard user presses
Enter on "Öffnen" and nothing happens where they are: the content appears **upstream in DOM
order**, so forward Tab never finds it, and Escape does not dismiss it.

Minimum fix in TASK-172 — Escape closes, focus follows a keyboard activation and returns on
close. Explicitly **not** a focus trap: it is not a dialog and does not claim `role="dialog"`.

The phone bottom sheet, which is the same content under `infoOnPin === false`, passes the full
contract 8/8 — focus in, trapped, Escape, restored, scroll locked and released. So does the
Objektpanel drawer on the day-one rendering (a building with NULL coordinates).

---

## F3 — contrast, computed from the parsed token file, in both themes

`demo/audit-map-contrast.mjs`: 60 measurements, tokens parsed out of `app/globals.css` and the
tile colours parsed out of `lib/map.ts`, with the browser used only to resolve `oklch()`.
18 flagged. **Two are real.** The other 16 are triaged below rather than dumped, because a
report that hands over 18 numbers hands over nothing.

### Real 1 — `--state-unres` is 4.34:1 under a WORD, in the light theme

```
light  --state-unres on --bg-raised (#fff)      4.34:1     need 4.5:1
light  --state-unres on --bg-base   (#fafafa)   4.16:1     need 4.5:1
dark   the same two pairs                    8.95 / 9.58:1  fine
```

`globals.css` paints words with it:

```css
.badge.unres, .shift-state-unresolved, .material-stage-decide { color: var(--state-unres) }
```

„Nicht bestätigt", „prüfen", „zu entscheiden" are text. 1.4.3 asks 4.5:1. Not map-specific —
this is every screen in the light theme that shows an unresolved shift or a material stage.

**Why it shipped: the two checks in this tree disagree about the tier for the same pair.**

```
demo/audit-contrast.mjs      need 3:1    'badge word + the 3px rule'   → ok
demo/audit-map-contrast.mjs  need 4.5:1  'a WORD, so body tier'        → FAIL
```

The map audit is right. A badge is a word first and a graphical object second, and scoring it
as a graphic is exactly what let 4.34:1 through.

Solved in-browser over both backdrops, chroma and hue unchanged: `oklch(0.58 …)` → **`0.55`**
(`#976712`) gives 4.92:1 on `#fff` and 4.63:1 on the base. 0.56 and 0.57 do not clear both.

### Real 2 — the map's own street labels are below 4.5:1 on the surface they sit on

```
dark   #6c7178 on #1b1e23 (a road)    3.40:1        #6c7178 on #101216   3.81:1
light  #7b8189 on #ffffff (a road)    3.93:1        #7b8189 on #f1f2f4   3.51:1
```

Our hexes, in `lib/map.ts`. Rendered text carrying street names. Lower severity than Real 1 —
these are context, not our data, and the Objektliste carries every fact the map shows — but it
is our colour and a one-value fix. Filed as a note on TASK-173 rather than as its own task.

### Triaged out, with the reason, so nobody re-raises them

| Flagged | Verdict |
|---|---|
| chip and box **fill** vs the tile, 1:1 × 4 | By construction, not a defect. `--bg-overlay` `#1b1e23` **is** the dark road colour; `--bg-raised` `#131519` **is** the building colour; in light both are `#fff`, and so is a road. 1.4.11 asks for the **boundary**, and the boundary passes: 3.33/3.23:1 for the chip's 1px border, 3.24:1 for the anchor stem. ⚠ noted below. |
| `.map-pin-flag.is-notag` hatching, 1.26:1 × 2 | Redundant reinforcement. The WORD „kein Tag" is the signal and it passes at 4.93 (dark) / 5.15 (light). |
| road vs ground 1.12:1, Danube 1.06/1.15:1, district boundary 1.37:1 × 2 | Google's geometry in the muted palette the owner chose (IA-PLAN §9). Not required to understand our content. It does mean the map reads as a nearly flat field — that is the price of "muted", and it is the owner's call, not a bug. |

⚠ **The caveat worth keeping.** Every pin's legibility rests entirely on a **1px border at
3.23–3.35:1** — about 0.2 above the threshold — because the fill is by design the same colour
as the tile. Any future darkening of `--border-strong`, or lightening of the tiles, takes the
pin below 3:1 with nothing else holding it up. Proved by doing it: `#101216` → `#8a9099` in
`lib/map.ts` drops the anchor stem from 3.24:1 to **1.62:1** and the row goes FAIL. Reverted.

`demo/audit-contrast.mjs` separately reports its 4 known `--border` hairline failures
(1.19–1.26:1) — pre-existing, unchanged by this round, reproduced with the same command.

---

## Horizontal overflow — 11 widths, every screen, panels open too

`demo/audit-widths.mjs`: **223/223**, 222 measurements across 11 widths × 19 states plus a
light-theme pass, plus the probe's own sabotage self-test.

```
767  768  800  900  1024  1152  1280  1366  1439  1440  1680
```

The middles matter as much as the edges — R1 of the previous round was a scrollbar living
between 768 and 1439 with neither endpoint showing it. The 19 states include the six new
open-panel URLs (`/?location=`, `/shifts/?location=`, `/workers/?worker=`, `/locations/?open=`,
`/payroll/?location=`, `/pl/?location=`), because a panel that overflows is a panel whose close
button is off screen, and a suite that only measures the resting state measures the state
nobody has a problem with.

---

## ICU — parsed, not regexed, and the parser found a hole in the check itself

`demo/audit-icu.mjs` against `@formatjs/icu-messageformat-parser@3.5.15`, already in the tree.
**17/17**, 1041 keys per locale, 107 plurals scanned.

Key parity ✓ · plural shape (categories, offset, plural type) across locales ✓ · every CLDR
category `de-AT` and `en` require ✓ · argument type and style parity ✓ · every literal `t()`
key resolves across 57 files ✓ · „Jänner" not „Januar", checked against `Intl`'s own `de-AT`
output ✓ · formal register, no Du/Dein ✓.

**One asymmetry, and it is correct.** `de` carries 54 plurals to `en`'s 53:
`pl.methodUnpricedLabour` selects on `{workers}` a second time for grammar alone —
„um diesen Lohn" / „um diese Löhne" — where English says "by that pay" invariantly.

**The hole.** The file's header claims it catches a branch that hardcodes the digit instead of
`#`. It did not. Mutating de.json to

```json
"toDoNoEmail": "{count, plural, one {1 Mitarbeiter ohne E-Mail} other {# Mitarbeiter …}}"
```

left the run at **16/16 green**: same argument set, same categories, and `anyPound` is
deliberately loose (*is the number printed at all for this argument*) so that the legitimate
German second selection above is not reported as broken. The screen renders „1 Mitarbeiter"
for every count and every check agrees it is fine.

Closed with an absolute, locale-independent rule instead of a parity one — **inside a single
plural, if any keyword branch prints the number, every keyword branch must** — with `=0`
branches exempt by construction, since „keine offene Schicht" naming no digit is the entire
reason exact-value branches exist, and four real messages use them that way. Clean on the
shipped files; RED on the mutation, in both directions:

```
de  one {1 Mitarbeiter ohne E-Mail}       → FAIL [other] print the number, [one] spell it out
en  other {several shifts to confirm}     → FAIL [one] print the number, [other] spell it out
de  plural loses its 'one' category       → FAIL ×2 (the pre-existing checks 3 and 4)
```

All three reverted; `web/messages/` clean.

---

## URL parameters — 15 mangles × every parameter × every screen that reads it

`demo/audit-params.mjs`: **59/60**. Every mangle degrades to the screen's own default —
compared against the unfiltered baseline by row count *and by which objects are on screen* —
and nothing renders an alert, injects a `<script>`, or leaks a message key.

```
empty · whitespace · word · zero · negative · float · exponent · leading zero · huge
nul byte · markup(<script>) · traversal(../) · long(4000 chars) · sql-ish · unicode
```

The two-wrongs rule of `lib/filters.ts` holds on every screen: unparseable is dropped
silently, a well-formed id naming nothing is **said out loud** in the chip and a notice, and no
panel opens on a different object.

### F4 — the one real failure: an uppercased UUID

```
FAIL an UPPERCASED but otherwise identical uuid still finds its building
     → 'Objekt: unbekannt – dieses Objekt ist hier nicht vorhanden'
```

`lib/filters.ts:133` accepts the shape case-insensitively (`/…/i`) and passes the value through
unchanged; the row lookup is a string compare against the lowercase id Postgres returns. A URL
that is correct to any human, and correct per RFC 4122, resolves to nothing.

It **degrades safely** — says so out loud, shows no other object's data. Wrong, not dangerous.
It matters because UUIDs get uppercased in transit: Windows and .NET format them uppercase, and
so do several tag writers — and decision-21 puts the location UUID in the tag URI. One line at
the parse boundary, where both `isUuid` callers already are. TASK-174.

### Three failures that were the check's fault, and the fix that kept it honest

The first run reported four failures. Three printed evidence like this:

```
FAIL /pl/ ?location= — first row "Aerztezentrum Landstrasse Objektpanel öf"
                     ≠ baseline "Aerztezentrum Landstrasse Objektpanel öf"
```

Two identical strings. The fingerprint was the first row's first 90 characters, and it is not
stable. Two causes, both real, neither a filter leak:

- `/contracts/` holds **two contracts for one building** (decision-28's history) and the query
  has no tiebreak, so the same screen renders them in either order;
- `/`'s Objektliste **re-sorts once the occupancy fetch lands**, so a fingerprint taken at
  1100 ms is a fingerprint of a half-loaded list.

Reproduced in isolation at a longer settle: both screens stable and identical. A check that
cries "leak" at a sort order is a check that will be ignored on the day it is right, so the
comparison is now the **sorted set of objects on screen**, which is immune to order and still
answers the actual question — a filter that half-applied removes rows, a filter that applied
someone else's id substitutes them, and both change the set.

**Proved it can still go red** by feeding a *real* location UUID in as a 16th mangle:

```
/shifts/            REDPROOF: 16 rows, baseline 87
/material-requests/ REDPROOF: objects differ — missing [Elif Demir …] unexpected [...]
/                   REDPROOF: chips ["Objekt: Aerztezentrum Landstrasse"]
```

Reverted. ⚠ On `/shifts/` the object set came back empty (its rows have no `<th>`), so there
the check falls back to row count alone — which caught it, 16 vs 87, but the set half is doing
no work on that one screen.

---

## Colour is the second signal

`demo/check-ia-greyscale.mjs`: **PASS.** Run and cited here, but *not* committed by this pass —
it is another agent's file and staging it would sweep in work this run did not do. Every
domain state and every map state carries its own word, and states that share a word are checked for a luminance difference that survives
`format=gray` rather than only for a difference in hue.

```
pin        ● Ordination Gumpendorf  1 vor Ort  ▲ prüfen
pin        ○ Aerztezentrum Landstrasse  0 vor Ort
row        Ordination Gumpendorf | ● 1 Person vor Ort · Elif Demir | ▲ 1 Schicht nicht bestätigt
row        Aerztezentrum Landstrasse | ○ niemand vor Ort | nichts offen
```

Also re-confirmed here, because eight surfaces were aligned on it last round and it must not
drift: **0 cells on `/payroll/` read exactly `0,00 €`** — a worker with no hourly rate stays a
named, counted exclusion („1 Mitarbeiter ohne Stundensatz"), never a price of zero.

---

## Pre-existing red, reproduced not inherited

Run with the same commands, unchanged by this round, and **not** fixed here:

- `audit-overlays` and `audit-overlays2` both fail on `/account/` — no page-level `role=alert`
  region when idle. `app/account/page.tsx` is not in either commit under review.
- `audit-contrast` — 4 `--border` hairline failures at 1.19–1.26:1.
- `check-reports` (2) and `check-materials-account-login` (1) — the closed-`<details>` family
  the gaps phase already queued.

## One operational note that cost twenty minutes

`demo/check-map-home.mjs` restores the demo database in a `finally`. A run that is **killed**
never reaches it, and leaves `nfc_demo` with every building `active = false` and every
coordinate NULL — production's day-one state. Every later audit that needs pins then either
refuses or, worse, reports a green nothing. `audit-map-a11y` refused, loudly and correctly:

```
audit-map-a11y: no pins. Either the build carries no Maps key or the port is not 8080.
                Refusing to report a green nothing.
```

That refusal is the reason this document has numbers in it. Keep it in anything else that
needs a drawn map.

---

## What was not done

- **Nothing was fixed.** Four defects, four tasks, no application code touched. F1 and F2 are
  in `lib/useOverlay.ts` and `components/HomeMap.tsx`, both of which other work in this round
  is holding.
- **Screen reader output was not heard.** Every assertion here is DOM, focus and computed
  colour. `aria-modal`, names and live regions are verified as markup; how VoiceOver or NVDA
  actually announces the map region and the info box is untested.
- **Zoom to 400% (1.4.10) was not measured.** Widths were, at 11 of them; reflow under text-only
  zoom is a different axis and is not in this run.
- **`prefers-reduced-motion` was not checked** against the map's pan/zoom animations.
- **Production was not touched**, and the geocoding backfill (TASK-170) is still unrun, so the
  live `locations` row still has NULL coordinates — which is why the day-one rendering, not the
  pinned one, is the case F2's Objektpanel-drawer half was measured on.
