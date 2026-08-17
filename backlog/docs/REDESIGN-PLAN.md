# Admin redesign — build order

Turns `docs/brand/prototype.html` into a buildable sequence. The prototype IS the spec.

**Amendment on record**: accent is BLUE. `oklch(.72 .17 250)` dark / `oklch(.55 .12 250)` light.
Android shipped blue in v1.4/v1.5. There is no hue-190 cyan anywhere in this plan.

**Spec correction**: `docs/brand/DESIGN.md` **does not exist on disk**. `docs/brand/` holds
`prototype.html` and nothing else. Every "the prototype wins where they disagree" question is
therefore moot — there is one document, and this plan reads only from it. If DESIGN.md turns up
later, it does not override anything here.

---

## 0 · The problem, and the one structural call

Measured, not asserted:

| screen | lines | inputs mounted |
|---|---|---|
| `/locations/` | 1160 | 14 |
| `/shifts/` | 943 | 12 |
| `/workers/` | 643 | 5 |
| nav | — | 12 flat entries |

Every screen mounts list + permanently-open create form + filters + prose simultaneously.

The fix, in one line: **lists read, drawers write, modals confirm, and every screen says its
question.**

### THE ONE CALL THAT DECIDES EVERYTHING ELSE

The prototype's `.row` is a `<div>` CSS grid. This project's tables are `<table class="data-table">`
and TWO shipped mechanisms depend on that being a real table:

- the ≤767px row-to-card transform (`globals.css`, decision-28)
- `components/ResponsiveTableLabels.tsx`, which captions cards by **cell position**

Rewriting tables as div-grids breaks both, and breaks column/row association for screen readers
on exactly the screens where it matters most (payroll, P&L, analytics).

**Decision — do not port `.row` onto tabular data.**

```
tabular data  → stays <table class="data-table">
                gets the prototype's LOOK as CSS: 3px left rule + .badge + tabular nums
non-tabular   → the prototype's .row div-grid, via <AttentionList>
attention list  callers: / (Zu erledigen) and /shifts/ (top-of-page triage). Two. That is the floor.
```

Everything below assumes this. Anyone who "simplifies" it by turning a table into divs has
broken the phone layout and will not find out from a green test.

---

## 1 · TOKEN LAYER

Owner: **Foundation agent only.** `web/app/globals.css` has exactly one writer, for the whole
workstream.

### 1.1 New canonical tokens — add verbatim

Replace the existing `:root` block. Values are the prototype's, unchanged.

```css
:root {
  color-scheme: dark;                 /* NOT in the prototype. Without it, native <select>,
                                         date pickers and scrollbars render light-on-light
                                         and a control disappears. */
  --bg-base:    #0B0C0E;              /* never #000: flat has no shadows, elevation is a
                                         LIGHTER surface, and black has no basement */
  --bg-raised:  #131519;
  --bg-overlay: #1B1E23;
  --bg-sunken:  #08090B;

  --text-primary:   #E9EAEC;
  --text-secondary: #A9ADB4;
  --text-muted:     #6C7178;

  --border:        rgba(255,255,255,.08);
  --border-strong: rgba(255,255,255,.16);

  --accent:      oklch(.72 .17 250);
  --accent-weak: oklch(.72 .17 250 / .14);
  --accent-text: #06131F;

  --state-open:      oklch(.72 .17 250);
  --state-unres:     oklch(.78 .14 75);
  --state-corrected: oklch(.72 .13 300);
  --state-muted:     var(--text-muted);

  --r-ctrl: 6px; --r-card: 10px;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px;
  --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

[data-theme="light"] {
  color-scheme: light;
  --bg-base:#FAFAFA; --bg-raised:#FFF; --bg-overlay:#FFF; --bg-sunken:#F1F2F4;
  --text-primary:#16181C; --text-secondary:#4B5057; --text-muted:#767C85;
  --border:rgba(0,0,0,.10); --border-strong:rgba(0,0,0,.18);
  --accent:oklch(.55 .12 250); --accent-weak:oklch(.55 .12 250 / .12); --accent-text:#FFF;
  --state-open:oklch(.55 .12 250); --state-unres:oklch(.58 .11 75);
  --state-corrected:oklch(.52 .11 300);
}
```

`'Inter'` is **not** a dependency and must not become one. It is a `font-family` name; if the
machine has it, it is used, otherwise the system stack behind it wins. No `@font-face`, no
`next/font`, no download. Do not add one.

### 1.2 Legacy tokens become aliases, not deletions

~1000 lines of existing CSS and every screen reference the old names. Deleting them is a
big-bang rename across 14 files owned by 14 different agents. Alias instead, in the same
`:root`, immediately after the block above:

```css
:root {
  /* SUNSET. Aliases so the existing stylesheet works in dark mode the moment the tokens
     land. Delete the whole block in the cleanup task once `rg -- '--(bg|surface|ink|ink-muted
     |accent-soft|focus|space-)' web/` returns nothing outside this block. */
  --bg:          var(--bg-base);
  --surface:     var(--bg-raised);
  --ink:         var(--text-primary);
  --ink-muted:   var(--text-secondary);
  --accent-soft: var(--accent-weak);
  --focus:       var(--accent);
  --space-1: var(--s1); --space-2: var(--s2); --space-3: var(--s3);
  --space-4: var(--s4); --space-6: var(--s5); --space-8: var(--s6);
}
```

Mapping is exact — old `--space-1/2/3/4/6/8` = `4/8/12/16/24/32px` = new `--s1..--s6`.
`--s7` (48px) is new and has no legacy name.

`--border` keeps its name and changes VALUE (`#d8dce3` → `rgba(255,255,255,.08)`). That is
intentional and is why the aliasing works at all.

`--desktop-min: 1024px` and `--sidebar-w` survive unchanged. `--sidebar-w` is
`clamp(13rem,16vw,19rem)`; the prototype's sidebar is `210px`. Keep the clamp — a fixed 210px
clips a two-line German label, which is the one thing decision-8 forbids.

### 1.3 Existing rules that become DEAD — name them, delete them, do not leave both

| rule in `globals.css` | superseded by | who deletes it |
|---|---|---|
| `.shift-state-open/-unresolved/-resolved/-complete` bg+colour | `.badge.open/.unres/.corr` + `.row .rule` | Foundation (rewrites), `/shifts/` + `/` verify |
| `.row-attention` stripe gradient | 3px `--state-unres` left rule on the first cell | Foundation |
| `.row-inactive` stripe gradient | `.badge` + `--text-muted` row text | Foundation |
| `.material-stage-decide/-order/-deliver/-done` | `.badge` state modifiers | Foundation |
| `.material-stage-refused` | `.badge` + `text-decoration: line-through` **keep the line-through** | Foundation |
| `.worker-form` | `<Drawer>` + `.field` | **the LAST screen to migrate**, in the cleanup task. Not before — a half-migrated screen still mounts one. |
| `.page-summary` | `<AnswerBand>` | Foundation |
| `.callout` (as a card) | `<ListPanel>` + `.note` | Foundation keeps `.note`/`.note.bad`, drops the card chrome |
| `.button-primary` / `.button-secondary` | `.btn.btn-primary` / `.btn.btn-ghost` / `.btn.btn-quiet` | Foundation adds `.btn*`, keeps the two legacy classes as thin aliases, cleanup task deletes them |
| `.nav-heading` (single "Verwaltung" heading) | per-group headings, `.side .grp` | Foundation |

**Not dead, do not touch**: `.visually-hidden`, `.skip-link`, `.code-inline`, `.code-block`
(`user-select:all` is load-bearing for the tag URI), `.tag-uuid`, `.col-numeric`, `.panel-metrics`,
`.map-canvas` + `.map-canvas[hidden]`, `.building-photo`, `.trend-bar`, `.share-panel`, the whole
`.portal*` block, and the entire `@media (max-width:767px)` block.

### 1.4 Three additions the prototype does not contain but the product needs

```css
/* a. The client portal is read by an OUTSIDE company. Nobody approved turning their page
      dark. Re-declare the light values on the portal subtree; custom properties cascade. */
.portal { color-scheme: light; --bg-base:#FAFAFA; --bg-raised:#FFF; /* …full light set… */ }

/* b. Payroll gets printed for an audit. Dark tokens print as black rectangles and eat a
      toner cartridge. */
@media print { :root { color-scheme: light; /* …full light set… */ } }

/* c. The left state rule on a <table>. A border on <tr> is NOT painted under
      `border-collapse: collapse` in every engine — it silently no-ops. Put it on the first
      cell, which works in both the table layout and the ≤767px card layout. */
.data-table tbody tr > *:first-child { border-left: 3px solid transparent; }
.data-table tbody tr.is-open   > *:first-child { border-left-color: var(--state-open); }
.data-table tbody tr.is-unres  > *:first-child { border-left-color: var(--state-unres); }
.data-table tbody tr.is-corr   > *:first-child { border-left-color: var(--state-corrected); }
```

Mutation test for (c), and it is not optional: set the colour to `transparent` on purpose,
screenshot `/shifts/`, confirm the rule VANISHES, put it back. A rule that never painted looks
identical to a rule that painted correctly in a passing test.

### 1.5 Dark default, light how?

Dark is `:root`. Light is `[data-theme="light"]` on `<html>`. **No toggle ships in this
workstream** — the token block costs 6 lines and makes a toggle a one-line `setAttribute`
later. Building the toggle now means a persistence store, a no-flash inline script and an SSG
hydration mismatch, for a preference nobody asked for. Filed as its own low task; it is not a
screen's job and no screen agent may add one.

---

## 2 · COMPONENT SET

Owner: **Foundation agent only.** `web/components/*` has exactly one writer.

Rule applied throughout: a component with one caller is a function or just JSX. Everything
below is justified by caller count or by owning a piece of accessibility that must not be
reimplemented 9 times.

### 2.1 `lib/useOverlay.ts` — hook, not a component

```ts
export function useOverlay(open: boolean, onClose: () => void): RefObject<HTMLElement | null>
```

Callers: `Drawer`, `Modal`. Two. It exists because these are the a11y rules that get
half-implemented otherwise:

- on open → focus the first focusable descendant (the prototype focuses the first `input`)
- `Tab`/`Shift+Tab` cycle inside the ref, never escape it
- `Escape` → `onClose()`, always, including mid-save
- on close → restore focus to the element that had it before open, **and if that element is no
  longer in the document** (the row that opened the drawer was resolved away by the save) fall
  back to `#main-content`, which already carries `tabIndex={-1}` for the skip link. Focus
  landing on `<body>` is the silent failure here — the keyboard user is teleported to the top
  of the document with no announcement.
- lock `document.body` scroll while open, restore on close

`ponytail:` focus trap only, no `inert` on the shell. Ceiling: a screen reader in browse mode
can still read the page behind the drawer. Upgrade path: add `inert` to `.app-shell` when an
overlay is open — one attribute, one line, do it if a real user hits it.

**System rule that falls out of "Escape always closes": result messages live on the PAGE, in
the page's `aria-live` region — never inside the overlay.** An overlay that closes on success
takes its own success message with it, unread. This is also what keeps the locations
copy-tag-URI notice working (§5).

### 2.2 Components

| component | props | its ONE job | callers |
|---|---|---|---|
| `PageHeader` | `{ title, question, action?: ReactNode }` | `.topline` — `<h1>` + the German question under it + optional primary button | 13 |
| `AnswerBand` | `{ cells: { k, v, sub?, calm?: boolean }[] }` | the number you read first | `/`, `/payroll/`, `/pl/`, `/analytics/`, `/shifts/` — 5 |
| `ListPanel` | `{ title, action?: ReactNode, children }` | the `.list` shell + `.lh` header; kills the card-in-a-card | ~12 |
| `AttentionList` | `{ items: { id, who, where, state?, trailing?, onOpen }[] }` | the prototype's `.row` grid, for NON-tabular attention rows | `/`, `/shifts/` — 2 |
| `StateBadge` | `{ state: 'open'\|'unres'\|'corr'\|'muted', label: string }` | the WORD, tinted second | `/`, `/shifts/`, `/material-requests/`, `/contracts/` — 4 |
| `Field` | `{ id, label, required?, optional?, help?, error?, children }` | `<label for>` ↔ control, the `*`/`optional` marker, `aria-describedby` wiring for help+error | ~11 |
| `Drawer` | `{ open, onClose, title, step?, footer, busy?, children }` | where every WRITE happens | ~9 |
| `Modal` | `{ open, onClose, title, footer, children }` | small centred dialog | `/workers/` (code reveal), `/locations/` (share link), + every `ConfirmModal` |
| `ConfirmModal` | `{ open, onClose, onConfirm, title, body, confirmLabel, destructive?, busy? }` | plain yes/no for the irreversible | revoke code, deactivate worker, deactivate location, refuse material request, delete contact — 5 |
| `EmptyState` | `{ children }` | "leer heißt: nichts zu tun", not a broken screen | ~10 |

`AttentionList` is the thinnest at 2 callers. It survives because it is where the whole
`.row/.rule/.badge` treatment lives and because a hand-rolled second copy is exactly how the two
diverge. **If `/shifts/` ends up not using it, delete it and inline the JSX into `/`.** Say so in
the review.

`ConfirmModal` wraps `Modal` rather than duplicating it. It exists for 5 callers × ~10 lines of
identical pending-action state machine, and because the destructive confirm is where an
`aria-describedby` gets forgotten.

### 2.3 Explicitly NOT built

`Button` (a `.btn` class is enough — a component adds a prop layer over `type`, `disabled` and
`onClick` and buys nothing), `Card`, `Table`, `Toolbar`, `Icon`, `Tooltip`, `Toast`, any
`useForm`. If a screen agent wants one, that is a note in the task, not a file.

---

## 3 · NAV REGROUPING

Owner: **Foundation agent only.** `web/lib/nav.ts` + `web/components/SidebarNav.tsx`.

12 flat → 3 visible groups + 2 unlabelled blocks. All 12 entries survive; nothing is hidden.

```
(no visible heading)          Übersicht          /
                              Schichten          /shifts/
                              Material           /material-requests/
STAMMDATEN                    Mitarbeiter        /workers/
                              Objekte            /locations/
                              Kunden             /clients/
                              Verträge           /contracts/
                              Produkte & Geräte  /inventory/
AUSWERTUNG                    Lohn               /payroll/
                              Ergebnis           /pl/
                              Objektauswertung   /analytics/
── margin-top:auto ──
(no visible heading)          Konto              /account/
```

`/material-requests/` sits top-level, not under Stammdaten, and the existing comment in
`nav.ts` already says why: a worker is standing in a building **waiting** on that queue. It is a
today problem, not a catalogue one. Keep that comment.

### 3.1 Shape

```ts
export type NavGroup = {
  headingKey: NavKey
  /** true → heading is .visually-hidden. The block is still a real, labelled group. */
  hidden?: boolean
  /** true → pushed to the bottom with margin-top:auto */
  pinBottom?: boolean
  items: readonly NavItem[]
}
export const NAV_GROUPS: readonly NavGroup[] = [ … ]

/** Derived, kept so nothing that imports the flat list breaks. */
export const PRIMARY_NAV: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
```

`PRIMARY_NAV` has exactly one importer today (`SidebarNav`). Keeping it derived is one line and
removes the temptation to grep-and-replace across files owned by other agents.

`FUTURE_NAV`, `LOGIN_PATH`, `CLIENT_PORTAL_PATH` unchanged. `FUTURE_NAV` is empty and its
`.length === 0` guard is load-bearing — a "Kommt später" heading over an empty list reads as a
sidebar that failed to load. Leave the machinery, do not restyle it.

Every group renders `<ul aria-labelledby={headingId}>`; a hidden heading is `.visually-hidden`,
**never** `display:none` — a hidden heading is still the group's accessible name.

### 3.2 Message keys and values (fragment, not de.json)

New keys — 4:

| key | de (de-AT) | en |
|---|---|---|
| `nav.groupToday` | `Heute` | `Today` |
| `nav.groupMasterData` | `Stammdaten` | `Master data` |
| `nav.groupReports` | `Auswertung` | `Reports` |
| `nav.groupAccount` | `Konto` | `Account` |

Changed VALUES on existing keys — 3, to match the prototype's shorter labels:

| key | de: from → to | en → |
|---|---|---|
| `nav.payroll` | `Lohnabrechnung` → `Lohn` | `Payroll` → `Pay` |
| `nav.plDashboard` | `Gewinn & Verlust` → `Ergebnis` | `Profit & loss` → `Result` |
| `nav.materialRequests` | `Materialanforderungen` → `Material` | `Material requests` → `Material` |

`nav.contractManagement` `Vertragsverwaltung` → `Verträge`, `Contract management` → `Contracts`.

`nav.primaryHeading` (`Verwaltung`) becomes unused once groups have their own headings. Leave the
key in place — `pnpm check` enforces parity, not usage — and delete it in the cleanup task.

Foundation writes these to `web/messages/_fragments/nav.de.json` / `nav.en.json`. **Foundation
does not edit `de.json` or `en.json` either.** The Merge agent is the only writer.

---

## 4 · SCREEN BATCHES

### 4.1 The file-ownership map

```
web/app/globals.css          Foundation ONLY
web/lib/nav.ts               Foundation ONLY
web/lib/useOverlay.ts        Foundation ONLY
web/components/*             Foundation ONLY
web/messages/de.json         Merge ONLY
web/messages/en.json         Merge ONLY
web/lib/{api,payroll,pl,period,money,materials,map,shifts,tag,portal}.ts
                             FROZEN. Nobody. If a screen cannot be built without a change
                             here, write it in the task and stop.
server/**, NFCTimeSheets/**, ops/branding.json, well-known
                             OUT OF SCOPE. Write it down instead of doing it.
web/app/<screen>/page.tsx    that screen's agent, and nobody else
web/messages/_fragments/<screen>.{de,en}.json
                             that screen's agent, and nobody else
```

Because every screen agent touches exactly one page file plus two fragment files it created,
**no two screen agents can collide.** Batching below is therefore about review capacity and
about proving the pattern before it reaches the money screens — not about file locks.

### 4.2 Batches

**B0 · Foundation** — serial, blocks everything.
Tokens, `useOverlay`, the 10 components, `nav.ts`, `SidebarNav`, `AppShell`.
Ends with: `pnpm lint && pnpm typecheck && pnpm build` green, and one screenshot of the
untouched `/workers/` proving the legacy aliases render the old markup correctly in dark mode.
Effort **high** — every later batch inherits its mistakes.

**B1 · The four the owner measured** — parallel ×4.
`/` · `/shifts/` · `/workers/` · `/locations/`
These are the 1160/943/643-line screens and the ones that carry the reviewer's verdict. Reviewed
together, as a set, because the drawer pattern has to look identical across all four.
Effort **high** (`/locations/`, `/shifts/`), **medium** (`/`, `/workers/`).

**B2 · The remaining record screens** — parallel ×4.
`/clients/` · `/contracts/` · `/inventory/` · `/material-requests/`
Same pattern as B1, no new inventions. Effort **medium** each.

**B3 · The money screens** — parallel ×3, deliberately last of the substantial work.
`/payroll/` · `/pl/` · `/analytics/`
Late on purpose: the reconciliation line, the named exclusions and the CSV are where "make it
lighter" turns into "deleted something true". By B3 the pattern is settled, so the review can
spend its whole budget on whether anything true went missing. Effort **medium**, risk **high**.

**B4 · The two small ones** — parallel ×2.
`/account/` · `/login/`
`/login/` has no shell, no drawer, no list — tokens and `.field`/`.btn` only. Effort **low**.

**B5 · Merge + verify** — serial, single agent.
Fold every `_fragments/*.{de,en}.json` into `de.json`/`en.json`, delete `_fragments/`, run the
full `cd web && pnpm verify`, then the visual pass in §5.6. Effort **medium**.

**B6 · Cleanup** — serial, after B5 is green.
Delete `.worker-form`, `.page-summary`, `.button-primary`/`.button-secondary`, `nav.primaryHeading`,
and the entire legacy-alias token block — each only after `rg` proves zero remaining references.
Effort **low**, but it is the task that stops the codebase carrying two design systems forever.

Order: `B0 → B1 → B2 → B3 → B4 → B5 → B6`.

### 4.3 What a screen agent runs

`cd web && pnpm lint && pnpm typecheck`

**Not `pnpm verify`, and not `pnpm build`.** `pnpm check` compares `de.json` against `en.json`
and the new keys are still sitting in fragments, so it fails by design until B5. `next build`
prerenders every page and next-intl on a missing key is at best a build-log error. `tsc` does not
key-check `t()` (only `NavKey` is typed off the message tree), so typecheck stays honest and
green. **Only the Merge agent runs `pnpm verify`, and it must be green before anything is
called done.**

### 4.4 Per-screen question line (the German under the `<h1>`)

Non-negotiable per the prototype; a screen with no question has not been redesigned.

| screen | Frage (de-AT) |
|---|---|
| `/` | Muss ich gerade etwas tun? |
| `/shifts/` | Welche Schichten brauchen eine Entscheidung? |
| `/workers/` | Wer arbeitet für uns, und wer kommt noch nicht rein? |
| `/locations/` | Welche Objekte betreuen wir, und welches Tag gehört dazu? |
| `/clients/` | Für wen arbeiten wir, und wen rufe ich dort an? |
| `/contracts/` | Was ist vereinbart, und seit wann? |
| `/inventory/` | Was haben wir, und was kostet es? |
| `/material-requests/` | Worauf wartet gerade jemand vor Ort? |
| `/payroll/` | Was ist diesen Monat auszuzahlen? |
| `/pl/` | Verdienen wir an diesem Objekt? |
| `/analytics/` | Wo geht die Zeit hin? |
| `/account/` | Wer bin ich hier, und wie melde ich mich ab? |
| `/login/` | — (no shell, no question line) |

English at exact key parity, same meaning, shorter is fine.

---

## 5 · RISK LIST — what regresses silently

Ordered by how quietly it breaks.

### 5.1 The mobile row-to-card transform
The ≤767px block keys off `table.data-table` + `thead`/`tbody`/`tfoot`. A screen that becomes
div-grids loses the card layout and gets a page that scrolls sideways — the exact failure
decision-7 predicted and decision-28 spent a task fixing.
**Guard**: every screen task's AC requires a 390px screenshot, LOOKED AT.

### 5.2 `ResponsiveTableLabels` captions cards by POSITION
It walks `[...row.children]` — `<th>` and `<td>` together — and matches index-for-index against
`thead th`. Insert a column, drop the leading `<th scope="row">`, or reorder a header, and every
card is captioned with the WRONG column. The file's own comment records that this shipped once
and that **every automated assertion stayed green while it was wrong**.
**Guard**: `thead` cell count == `tbody` row child count, and the 390px screenshot is read for
captions, not just for shape. This is the single highest-probability silent regression here.

### 5.3 The 3px state rule may never paint
A border on `<tr>` under `border-collapse: collapse` is not painted by every engine. §1.4(c)
puts it on the first cell for that reason. A rule that never painted is indistinguishable from a
rule that painted correctly, in every screenshot diff that has no baseline.
**Guard**: mutation test — set it `transparent`, confirm the screenshot changes, put it back.

### 5.4 Payroll's reconciliation and the named exclusions
`reconcile()` produces `missingCents` (server total vs visible total) and per-line
`excludedUnresolved` / `excludedOpen` / `excludedNone` counts. These are the difference between a
payroll screen and a payroll screen you can defend in a wage dispute. "Too much text" is not a
licence to remove them.
**Guard**: AC — the reconciliation line and every exclusion count still render, with the same
numbers as before the change, for the same input. Typeset smaller, or moved into the row's
drawer. Never dropped. A worker with no rate still reads as **excluded**, never as `0,00 €`.

### 5.5 The CSV export
`downloadCsv()` in `/payroll/`: the `\uFEFF` BOM (Excel reads UTF-8 without it as mojibake for
`Jänner`), the `payroll-<businessDate>.csv` filename derived from the Vienna business date, and
the column set `csvWorker/csvHours/csvRateCents/csvAmountCents/csvAmountEuro/csvManualShifts`.
Moving the button is fine. Touching the function is not.
**Guard**: AC — export a file after the change, open it, byte-compare the header row and the
first data row against a pre-change export.

### 5.6 The copy controls — tag URI and client portal link
`/locations/` `.code-block` with `user-select: all` shows the tag URI **whole, never elided**: a
URI truncated for layout is a URI somebody retypes wrongly onto a sticker. Both copy paths fall
back to a visible notice when `navigator.clipboard` is refused (insecure origin, permission).
If that control moves into a drawer or modal, **the notice must remain a page-level `aria-live`
region** (§2.1) — otherwise a failed copy is announced into an overlay the user just closed, and
they paste the wrong thing into a message to a worker.
**Guard**: AC — deny clipboard permission in the browser, confirm the failure notice is visible
and announced, confirm the full URI is still selectable on screen.

### 5.7 Focus restoration
The prototype's `closeAll()` does `lastFocus && lastFocus.focus()`. That works right up until
the save removes the row that opened the drawer — a resolved shift leaves the list — and then
`lastFocus` is detached, `.focus()` silently no-ops, and focus falls to `<body>`.
**Guard**: `useOverlay` falls back to `#main-content` (already `tabIndex={-1}`). AC — resolve an
unresolved shift from its drawer with the keyboard only, press Tab, confirm focus is inside the
list and not at the top of the document.

### 5.8 `oklch()` and the theme flip
`oklch()` needs Chrome 111+/Safari 15.4+. Fine for the one operator, but `--accent-weak` uses the
`oklch(… / .14)` alpha form, which is a separate support question from `oklch()` itself.
`color-scheme` (§1.1) is what stops native `<select>` and date pickers rendering white-on-white
— without it a control on `/shifts/` becomes invisible rather than ugly.
**Guard**: one real render via `demo/cdp.mjs`, dark and light, with a `<select>` open.

### 5.9 The client portal turning dark
`/reinigung/` is read by a client's point of contact at another company. Nobody approved
restyling their page. §1.4(a) pins it light.
**Guard**: AC — `/reinigung/` screenshots byte-identical, or visually identical, to pre-change.

### 5.10 German plurals
TASK-40 already recorded `4 alte Schichts`. Every new count string is ICU plural with `one`/
`other`, and `pnpm check` parses the ICU AST rather than regexing braces — precisely because
`{count, plural, one {# Schicht} other {# Schichten}}` has one argument and four braces.
**Guard**: `pnpm check` at B5. Do not hand-concatenate a count.

### 5.11 The thing no test catches
Two white containers became one dark panel and the screen still says nothing. Skimmability is
not assertable. **Guard**: the reviewer reads each screen and answers, out loud, the question in
§4.4. If they cannot answer it from the top ~400px, the screen is not done.

---

## 6 · Backlog tasks

**19 tasks, `TASK-136` … `TASK-154`, all labelled `ux,redesign`.**

| task | subject | batch |
|---|---|---|
| TASK-136 | Foundation: token layer | B0 |
| TASK-137 | Foundation: overlay primitives (`useOverlay`, `Drawer`, `Modal`, `ConfirmModal`) | B0 |
| TASK-138 | Foundation: layout + state components | B0 |
| TASK-139 | Foundation: nav regrouping | B0 |
| TASK-140 | `/` dashboard | B1 |
| TASK-141 | `/shifts/` | B1 |
| TASK-142 | `/workers/` | B1 |
| TASK-143 | `/locations/` | B1 |
| TASK-144 | `/clients/` | B2 |
| TASK-145 | `/contracts/` | B2 |
| TASK-146 | `/inventory/` | B2 |
| TASK-147 | `/material-requests/` | B2 |
| TASK-148 | `/payroll/` | B3 |
| TASK-149 | `/pl/` | B3 |
| TASK-150 | `/analytics/` | B3 |
| TASK-151 | `/account/` | B4 |
| TASK-152 | `/login/` | B4 |
| TASK-153 | Merge: fold fragments, `pnpm verify`, visual pass | B5 |
| TASK-154 | Cleanup: delete superseded rules and legacy aliases | B6 |

> **This section was reconciled after the fact.** The Plan phase was force-stopped part-way
> through filing, so the table originally published here described tasks the plan agent
> *intended* to create, numbered `54`–`72` — those were its own internal row labels, never real
> task ids — and claimed 18 when its own rows enumerated 19. Only `TASK-136` … `TASK-140` had
> actually reached disk; the remaining fourteen were filed afterwards as `TASK-141` … `TASK-154`.
> The real ids are therefore not contiguous with the old row numbering, and the ordinals
> (`59000` … `72000`) carry the intended order instead.
>
> **The analysis was not affected.** Sections 0–5 were complete and correct when the run
> stopped and have not been touched; only the filing had to be recovered.

Deferred, not in this workstream: the light/dark toggle control (tokens ship, the control does
not) and anything in `NFCTimeSheets/` (TASK-129 — every user is on Android).

**Production is read-only.** 1 admin, 1 client, 1 location, 0 workers, 0 shifts. No deploy, no
service restart, no write. Local only; the owner deploys.
