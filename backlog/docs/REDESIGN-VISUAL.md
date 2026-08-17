# Admin redesign — the visual pass, LOOKED AT

Verification of commit `b5c30fd` ("the admin redesign lands"), which shipped **unverified**: the
run's Verify/Fix/Demo/Review agents all died with "Subagent produced no assistant output", so
until this document nothing had looked at it. Date of record **2026-08-17**, Europe/Vienna.

Method: `web` built from `b5c30fd`, served same-origin by `server/server.js` with
`PUBLIC_DIR=../web/out` on `:8082` against a seeded `nfc_demo`. The **previous** commit
(`b5c30fd~1`) was built in a `git worktree` at `/tmp/ct-before` and served on `:8083` against the
same database, so every "before" statement below is a **picture**, not a memory of one.
`sh demo/check-guards.sh` → **OK** (16 refusals still refuse) before anything else ran.
Production was never contacted.

Evidence: `docs/media/redesign/` — 62 images (13 screens + the client portal × {1680, 390} ×
{dark, light}, plus 5 `-bottom` shots), `truth-*.png` for the six load-bearing truths,
`grey/*-gray.png` for the greyscale test, `report.json` for the machine-readable measurements, and
`before/` — the same screens built from `b5c30fd~1`, kept because evidence that evaporates with
`/tmp` is not evidence. Reproduce with `node demo/shoot-redesign.mjs` and
`node demo/shoot-truths.mjs`; the before set with `SHOOT_OUT=<dir>
DEMO_BASE=http://127.0.0.1:8083 node demo/shoot-redesign.mjs` against the worktree build.

---

## 1. THE WEIGHT VERDICT — is it lighter?

**Yes, mostly, and on the screens that matter most it is dramatically lighter.** Nine screens
got lighter, three stayed the same, one got heavier. The mechanism is consistent and it is the
right one: **every inline create-form moved into a drawer, every intro paragraph became one
question, and every explainer moved BELOW the data instead of above it.**

The "every screen got longer in source" alarm from the commit message was a false alarm. Source
lines went up; rendered pixels went **down** on 10 of 13 screens.

Rendered page height, 1680px dark, before → after (`before/report.json` vs `report.json`):

| Screen | px before → after | top-level blocks | verdict |
|---|---|---|---|
| `/workers/` | 1888 → **1000** (−47%) | 4 → 2 | **LIGHTER** |
| `/clients/` | 1953 → **1000** (−49%) | 7 → 2 | **LIGHTER** |
| `/locations/` | 3334 → **1864** (−44%) | 5 → 3 | **LIGHTER** |
| `/inventory/` | 1486 → **1000** (−33%) | 3 → 1 | **LIGHTER** |
| `/pl/` | 2095 → **1823** (−13%) | 8 → 6 | **LIGHTER** |
| `/contracts/` | 1138 → **1002** (−12%) | 4 → 3 | **LIGHTER** |
| `/shifts/` | 6859 → **6152** (−10%) | 6 → 4 | **LIGHTER** |
| `/material-requests/` | 1884 → **1731** (−8%) | 6 → 5 | **LIGHTER** |
| `/analytics/` | 1733 → **1678** (−3%) | 6 → 5 | LIGHTER, marginally |
| `/payroll/` | 1181 → **1197** (+1%) | 5 → 5 | **SAME** height, lighter answer |
| `/` dashboard | 1282 → **1406** (+10%) | 4 → 4 + 3 notes | **SAME** — see below |
| `/login/`, `/reinigung/` | 1000 → 1000 | 1 → 1 | SAME |
| `/account/` | 1000 → 1000 desktop; **858 → 1087 at 390px (+27%)** | 1 → 2 | **HEAVIER on a phone** |

### The two clearest wins, with pictures

**`/clients/` was the complaint.** Before (`before/clients-1680-dark.png`): a paragraph, a create-client form card, a clients table, another paragraph, a
create-contact form card with four fields, and a second contacts table — literally *two stacked
white containers* plus two forms. After (`clients-1680-dark.png`): one note and **one** table in
which contacts hang under their client as `↳ David Kraus` rows. Two lists became one hierarchy.

**`/shifts/` buried its list.** Before (`before/shifts-1680-dark.png`): intro prose, filter, summary, note, an `<h2>Schicht
manuell erfassen`, more prose, a 4-line blue notice, a 4-field form card, another `<h2>` and more
prose — the shift log did not start until ~1290px down. After (`shifts-1680-dark.png`): KPI band,
filter, note, a `ZU ENTSCHEIDEN` triage card at 490px, the log at 770px. The hand-entry form is
behind `Schicht nachtragen` (`truth-shifts-drawer-nachtragen.png`).

### Where it did NOT get lighter, honestly

- **Dashboard (`dashboard-1680-dark.png`) is +10% and I will not call that lighter.** It *is*
  easier to skim — the three prose bullets of "Zu erledigen" became three scannable rows with
  state pills — but it now carries four carded blocks *and* three loose grey notes between them
  ("Alle aktiven Mitarbeiter haben eine Anmeldeadresse hinterlegt.", "Zeiten bezogen auf 17:44
  Uhr…", "Die 10 zuletzt abgeschlossenen Schichten… hier wird nichts zusammengezählt."). Verdict:
  **SAME weight, better skim.**
- **`/payroll/` (`payroll-1680-dark.png`) is +1%.** The gain is real but it is not weight: the
  answer (`Auszuzahlen 3.638,26 €`) is now the largest thing on the screen. The loss is that the
  explainer added at the bottom ships **expanded** (`<details className="callout" open>`), so the
  prose it removed from the top came back at the bottom.
- **`/account/` at 390px is +27%** (858 → 1087). The old screen was *unstyled* (native inputs, a
  default button — `before/account-1680-dark.png`), so this is a genuine improvement in looks paid
  for
  with a new four-line note ("Es gibt hier absichtlich kein „Passwort vergessen"…").
- **Light theme keeps the white-on-white problem** (`dashboard-1680-light.png`): cards are white
  on `#FAFAFA` separated by a hairline measured at **1.26:1**. Dark is the default and dark reads
  well; light still looks like stacked white containers, only more of them.

**The "card inside a card" is genuinely gone.** The surface-nesting probe in
`demo/shoot-redesign.mjs` finds **0** painted surfaces inside another painted surface on all 14
screens in all four configurations — and that probe was broken on purpose first: injecting a card
into a card made it report `1 — div inside section — "A CARD INSIDE A CARD"`.

---

## 2. One German question per screen, quoted

Every admin screen states its question in one line directly under the `<h1>`. Each replaced a
two-to-four-line paragraph (the before text is in `before/report.json`).

| Screen | question as rendered |
|---|---|
| `/` | „Muss ich gerade etwas tun?" |
| `/shifts/` | „Welche Schichten brauchen eine Entscheidung?" |
| `/material-requests/` | „Worauf wartet gerade jemand vor Ort?" |
| `/workers/` | „Wer arbeitet für uns, und wer kommt noch nicht rein?" |
| `/locations/` | „Welche Objekte betreuen wir, und welches Tag gehört dazu?" |
| `/clients/` | „Für wen arbeiten wir, und wen rufe ich dort an?" |
| `/contracts/` | „Was ist vereinbart, und seit wann?" |
| `/inventory/` | „Was haben wir, und was kostet es?" |
| `/payroll/` | „Was ist diesen Monat auszuzahlen?" |
| `/pl/` | „Verdienen wir an diesem Objekt?" |
| `/analytics/` | „Wo geht die Zeit hin?" |
| `/account/` | „Wie ändere ich mein Passwort?" (predates the redesign) |
| `/login/` | „Bitte melden Sie sich mit Ihren Administrator-Zugangsdaten an." (not a question — correct here) |
| `/reinigung/` | no question: it is a client-facing document, `<h1>` is the building name |

12/12 admin screens ✓.

---

## 3. GREYSCALE TEST — PASS

`grey/*-1680-dark-gray.png` and `grey/*-390-dark-gray.png` (14 screens, `ffmpeg -vf format=gray`).
Every state survives desaturation, because in every case the **word** carries it and colour is
only the second signal:

| state | what carries it in greyscale | evidence |
|---|---|---|
| running | word „Läuft" + 3px left rule + „Zählt nicht zur Bezahlung" | `grey/shifts-1680-dark-gray.png` |
| auto-closed, unresolved | word „Nicht bestätigt" + rule + „Zählt nicht zur Bezahlung" | same |
| corrected by a human | word „Korrigiert" + rule + „Zählt zur Bezahlung" | `grey/truth-shifts-state-korrigiert-gray.png` |
| complete | word „Abgeschlossen", **no** rule | same |
| hand-entered vs scanned | „Manuell erfasst" upright bold vs „Am Tag gescannt" italic grey — a WEIGHT difference | same |
| inactive worker | „Inaktiv – keine Anmeldung möglich" + „Inaktiv – kein Zugangscode möglich" | `grey/workers-1680-dark-gray.png` |
| no contract price | pill „Kein Preis hinterlegt" + rule | `grey/contracts-1680-dark-gray.png` |
| excluded from payroll | „Kein Stundensatz" / „Nicht bewertet" / „1 zu bestätigen" | `grey/truth-payroll-this-month-no-rate-gray.png` |

Nothing is identifiable by hue alone. Note that the amber (unresolved) and violet (corrected)
rules are **indistinguishable from each other** in greyscale — that is fine, and only because the
pill next to them prints the word.

Getting the „Korrigiert" state on screen at all required correcting a flagged shift through the
real drawer: `corrected_at` means "an auto-closed shift was resolved" and nothing else
(`server/check-api.js:1748` asserts an ordinary edit does not stamp it), so an ordinary edit
correctly shows „Abgeschlossen".

Computed contrast (`node demo/audit-contrast.mjs`, resolved through Chrome so the `oklch()` maths
is the one that paints): **14 failures**, listed as D6 below.

---

## 4. 390px

- **Horizontal scroll: none.** 0 of 28 page/configuration combinations overflow.
  ⚠ **This green had to be earned twice** — see D14: the check as committed *could not fail*.
- **Row-to-card captions: CORRECT.** Verified two ways. By eye: `workers-390-dark.png` prints
  `E-MAIL-ADRESSE (APP-ANMELDUNG) / TELEFON (NUR ZUM ANRUFEN) / STUNDENSATZ / STATUS /
  ZUGANGSCODE / AKTIONEN` against exactly those `<th>` strings; `shifts-390-dark.png` prints
  `OBJEKT / BEGINN / ENDE / DAUER (STD:MIN) / STATUS / ART DER ERFASSUNG`;
  `payroll-390-dark.png` prints `STUNDEN / STUNDENSATZ / BETRAG / NICHT GEZÄHLT`. And by probe:
  label TEXT compared to header TEXT (never a count), 0 mismatches, 36 labelled cells on
  `/workers/` alone — broken on purpose first: rewriting one `data-label` produced
  `cell[1] label="Stundensatz" header="E-Mail-Adresse (App-Anmeldung)"`, and deleting one cell
  produced `ROW WIDTH 6 vs HEAD WIDTH 7`.
- **Controls under 44px: many.** See D5. The 35px row-action buttons are the systematic one.

---

## 5. The load-bearing truths — each confirmed by LOOKING

| truth | verdict | picture |
|---|---|---|
| `/login/` input is `type="text" autoComplete="username"` | ✓ **intact** — label reads „Benutzername", read off the live DOM: `text / autocomplete=username` | `login-1680-dark.png`, `truths.json` |
| `/payroll/` server-vs-visible reconciliation | ✓ „Die hier geladenen Schichten ergeben genau die Summe des Servers für denselben Zeitraum – auf dieser Seite fehlt nichts." | `payroll-1680-dark.png` |
| `/payroll/` names its exclusions, counted | ✓ `Nicht gezählt 3 · „2 zu bestätigen · 1 noch offen"`, plus per-row „1 zu bestätigen · 1 noch offen" and two caveat bullets with „Jetzt bestätigen" / „Jetzt abschließen" | `truth-payroll-this-month.png` |
| a worker with no hourly rate is an EXPLICIT exclusion, never a silent 0,00 € | ✓ row prints „Kein Stundensatz" / **„Nicht bewertet"** (not 0,00 €), KPI names „1 Mitarbeiter ohne Stundensatz", caveat offers „Stundensatz hinterlegen" | `truth-payroll-this-month-no-rate.png` |
| `/locations/` shows and copies `https://schimmer-glanz.exe.xyz/t?l=<uuid>` | ✓ full URI in a `<code>`, `Tag-URL kopieren` per row, UUID printed under it | `locations-1680-dark.png`, `truth-locations-tag-copied.png` |
| `/workers/` enrolment code is an INLINE panel, never a modal, with expiry at copy time | ✓ inline (`inModal:false, inDrawer:false`), „Zugangscode für Andrea Steiner:", „**Gültig bis 22.08.2026, 18:02**. Danach einfach einen neuen erstellen.", „Zugangscode kopieren" — 5 days from 17.08 ✓ | `truth-workers-enrolment-code.png` |
| `/shifts/` has TWO drawers, not one behind a flag | ✓ „**Schicht nachtragen**": fields `Mitarbeiter* Objekt* Beginn* Ende*`, end `required=true`, submit „Schicht erfassen". „**Schicht korrigieren**": `Beginn*`, „Ende **optional**", end `required=false`, submit „Korrektur speichern" | `truth-shifts-drawer-nachtragen.png`, `truth-shifts-drawer-korrigieren.png` |
| deactivation stays soft | ✓ „Deaktivieren" / „Wieder aktivieren" on the same row; the inactive worker is still listed with his history | `workers-1680-dark.png` |
| `/reinigung/` wears no admin chrome and no theme switcher | ✓ `navLinks: 0`, `selects: 0`, `<h1>` is the building name, renders LIGHT even with `data-theme="dark"` stored, first names only („Marta", „Elif") | `truth-portal-shared-390.png`, `portal-390-dark.png` |

---

## 6. DEFECTS, each with the file that shows it

Severity is about the operator's day, not about effort.

**D1 — MAJOR, phone. `/locations/` cards render one character per line.**
`locations-390-dark.png`, `locations-390-light.png`. In a card, the multi-part cells lay out as
horizontal columns inside 390px, so „850,00 € pro Monat" prints as `8 / 5 / 0 / , / 0 / 0 / € /
p / r / o / M / o / n / a / t` down the screen, and the **tag-URL copy control** prints as `Ta /
g- / UR / L / ko / pie / re / n`. The control that writes a wall tag is unusable on a phone.
Pre-existing (`before/locations-390-dark.png` shows the same) — the redesign did not introduce it
and did not fix it.

**D2 — MAJOR, phone. `/workers/` clips its primary action.** `workers-390-dark.png` (crop at
y≈870): the enrolment button reads „**Zugangscode erste**" — cut at the card's right edge. There
is no horizontal scroll, so the rest of the label is simply gone. Every automated check passes on
this screen; only the picture shows it.

**D3 — MEDIUM, desktop. `/locations/` is over-columned at 1680px.** `locations-1680-dark.png`:
nine columns, the `STATUS` header breaks to `ST / AT / US`, building names break mid-word
(„Aerztezentru m Landstrasse"), and „Buerozent rum Handelskai GmbH" in the client column.
Pre-existing (`before/locations-1680-dark.png`); survived.

**D4 — MEDIUM, desktop. `/analytics/` breaks words in headers and collides a button with a
sentence.** `analytics-1680-dark.png`: `GELEISTET E ZEIT`, `VEREINBART E ZEIT`, `Nicht
berechenba r`; and the „Erneut verorten" button sits flush against the wrapped „…danach gefragt",
swallowing the end of the sentence — visible in `analytics-1680-dark.png` at y≈1030, and already
there in `before/analytics-1680-dark.png`. Pre-existing.
Also on that screen: the `KARTE` card contains nothing but an apology („Dieser Build enthält
keinen Google-Maps-Schlüssel…") — a whole competing block for an absence.

**D5 — MEDIUM, accessibility. Touch targets below 44px at 390px**, measured on the rendered box:
- **35px**: every row action — `Bearbeiten`, `Deaktivieren`, `Zugangscode erstellen`,
  `Als bestellt markieren`, `Ablehnen`, `Verlauf und Änderung`, `Alle Schichten ansehen`,
  `Kunden und Ansprechpersonen bearbeiten`, `Schichten prüfen`. Counts per screen: inventory 22,
  workers 21, locations 21, clients 19, material-requests 13, contracts 11.
- **36px**: the `Darstellung` and `Sprache` selects in the header, on every screen.
- **22.5px**: the `NFC TimeSheets Admin` brand link; the payroll `<summary>`.
- **17px**: inline links „Gewinn & Verlust öffnen", „Zurück zu den Objekten", „Vertrag
  hinterlegen", „Objekte öffnen".
- **40.5px**: the skip link (only reachable by keyboard; lowest priority).

**D6 — MEDIUM, contrast. 14 computed failures** (`node demo/audit-contrast.mjs`):
- `--text-muted` on the three surfaces: **3.98 / 3.72 / 3.40:1** dark and **4.03 / 4.21 / 4.21:1**
  light, against 4.5:1. This token renders `.cell-muted`, `.tag-uuid` and `.empty-state` — i.e.
  the printed tag UUIDs and every „Keine Nummer hinterlegt".
- `--border-strong` on base/raised: **1.55 / 1.62:1** dark, **1.52 / 1.53:1** light, against the
  3:1 that WCAG 1.4.11 asks of a control boundary. That is the input and `.btn-ghost` outline.
- `--border` at 1.19–1.26:1 is the table hairline and panel edge; the same number is why light
  theme's cards barely separate from the page (D13).

**D7 — SMALL. Internal decision IDs are printed to the operator** in German user copy:
„(decision-6)" on `material-requests-1680-dark.png` and `pl-1680-dark.png`, „(decision-10)" on
`pl-1680-dark.png` and `analytics-1680-dark.png`, „(decision-28)" on `contracts-1680-dark.png`.
The cleaning company's office manager has no decision log.

**D8 — SMALL. The explainers are prose, not disclosures.** `/payroll/` uses `<details … open>`, so
it ships expanded (`payroll-1680-dark.png`, 3 bullets). `/material-requests/` (~350px, 3
paragraphs), `/pl/` (7 bullets), `/analytics/` (4 bullets) and `/contracts/` (4 bullets) are
always-open blocks. Demoting them below the data was the right move; leaving them open keeps the
prose the complaint was about.

**D9 — SMALL. `/pl/` says the same thing five times** (`pl-1680-dark.png`): „keine Zielmarge
gesetzt" appears in the KPI sub-line, in a note, as the entire content of the `OBJEKTE UNTER DER
ZIELMARGE` card, in the `BEWERTUNG` cell of all six rows, and in the totals row.

**D10 — SMALL. `/payroll/` KPI mixes units.** `truth-payroll-this-month-no-rate.png`:
„Nicht gezählt **1**" with the caption „1 zu bestätigen · 1 Mitarbeiter ohne Stundensatz". The
number counts shifts; the caption counts shifts *and* workers.

**D11 — SMALL. Copy feedback lands far from the control.** `truth-locations-tag-copied.png`: the
message renders at the top of `<main>`, while the button pressed can be 5000px down at 390px
(`locations-390-dark.png` is 5136px tall). The message itself is good — it names the object and
falls back to „Die URL oben markieren und manuell kopieren".
*Not a defect:* the message in that shot is the failure text because headless Chrome denies
clipboard-write; the success path could not be photographed here.

**D12 — SMALL. The 390px nav is a blind horizontal scroller.** `dashboard-390-dark.png`: the strip
reads „Übersicht Schichten Material Mitarbeiter Obj⋯" and is cut at the viewport edge with no
affordance; the `STAMMDATEN` / `AUSWERTUNG` group labels that organise the desktop sidebar are
dropped. The sidebar was correctly **not** deleted at 390px, which was the requirement.

**D13 — INFO. Light theme barely separates its cards** (`dashboard-1680-light.png`,
`clients-1680-light.png`): white cards on `#FAFAFA` with a 1.26:1 hairline. Dark is the default
and is where the redesign reads as intended.

**D14 — HARNESS. The committed overflow check could not fail, and has been fixed.**
`demo/shoot-redesign.mjs` compared `documentElement.scrollWidth` with `window.innerWidth`. Under
CDP device-metrics emulation with `mobile: true`, an over-wide element makes **`innerWidth` grow
to match it** (measured: a 900px div on a 390px screen → `innerWidth: 900`), so the comparison
can never be true. Injecting a deliberately 900px-wide `<div>` produced `culprits=0`: a green
that meant nothing across 28 combinations. Now compared against `documentElement.clientWidth`
(stays 390), which reports `culprits=12` on the same injection. The suite was re-run after the
fix: **still 0 real overflows**, so §4's answer stands — but it is now an answer rather than a
tautology. Second harness bug fixed in the same file: the probe was attached to
`shots[length - 1]`, which on the five screens that also take a `-bottom` image was the bottom
entry, so `report.json` recorded `/shifts/` with `title: undefined` and no question line.

---

## What this pass did NOT do

- No app code was changed. Every defect above is reported, none is fixed.
- The clipboard **success** path is unphotographed (headless denies clipboard-write).
- Ratios are computed from tokens; no per-pixel screenshot contrast sampling was done.
- No keyboard-only or screen-reader pass. `aria-live` regions exist and were read via the
  protocol, but no assistive technology was driven.
- `docs/brand/DESIGN.md` exists on disk and is **stale**: it still specifies a hue-190 cyan
  accent. The shipped build is blue (`oklch(.72 .17 250)`), matching `prototype.html` and the
  amendment in `REDESIGN-PLAN.md`. Its state table (amber unresolved, violet corrected) *is*
  what shipped.
- The `truth-*.png` shots were taken against the seeded database with two deliberate edits — one
  shift corrected through the drawer, and one worker's rate set to 0 to force the no-rate
  exclusion. The database was re-seeded afterwards; the 62 canonical screenshots are from the
  clean seed.
