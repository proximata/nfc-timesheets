# LOOK — every admin screen, photographed and read

Status: findings, ranked by cost to the director. **Nothing was fixed.** No file under `web/`
was changed by this run.

Everything below was read off a picture. Where a picture and a probe disagreed, the picture
won, and the probe was re-run until it agreed or was discarded. The durable lesson of this
project is that 78 assertions stayed green while the phone layout captioned every card with
the wrong column, so this pass had one rule: **look, then measure to make the sentence exact
— never the other way round.**

## Method, and what a machine said about it

```
stack     web/ static export (de, Maps key) + demo/demo-server.mjs on 127.0.0.1:8080, nfc_demo
          PORT 8080 is not a preference: the browser key is referrer-locked to it
capture   demo/shoot-look.mjs         17 screens x {1680,1280} x {dark,light}, fold + full page
          demo/shoot-look-states.mjs  the states nfc_demo does not contain
guards    sh demo/check-guards.sh -> OK   (run first, 17 refusals + 66 files parse)
output    docs/media/look/  (GITIGNORED)  204 png + 204 desaturated twins in grey/
db        pg_dump before, restore in finally, row-count fingerprint either side
          -> "database restored, fingerprint MATCHES", twice
```

**The machine found nothing.** `shoot-look.mjs` reports zero fails and zero warns across all
four configurations: no horizontal overflow, no caption-vs-header mismatch, no theme drift.
`web/messages/de.json` and `en.json` are at exact key parity, 1232 each. Every finding below
is therefore something no assertion in this repo currently catches.

### States produced, because a state you cannot produce is a state you cannot judge

`/tags/` with tags in it · `/pl/` with a margin baseline (`app_settings` ships EMPTY, so the
flagged blocks — the actual output of that screen — had never been on a screen) · an unpriced
inventory item · a deactivated building · every drawer, confirm modal and one-shot secret
panel · a failed sign-in · loading · offline · 500 · 401 · a minted client-portal link and the
portal's **ready** state · one row · and an empty database.

---

# 1 · WRONG — it misleads him about money or hours

### W1 · `/pl/` reports a **100 % margin and a positive result** when no work was recorded
`docs/media/look/s30-pl-empty-db-1680-dark.png`

With every shift deleted and revenue untouched, the screen reads:

```
Ergebnis  2.760,00 €        Marge  100,00 %        Umsatz  2.760,00 €
Unter der Zielmarge  0      (Zielmarge 30,00 % IS set)
```

Labour cost of zero is rendered as the best month the company ever had. Nothing on the screen
says "no hours were recorded in this period". `/payroll/` has a whole reconciliation apparatus
against exactly this shape of failure (`caveatReconcile`, `caveatTruncated`); `/pl/` — the
screen that decides which buildings to keep — has no equivalent, and its own method note only
says the error's *direction* ("Ein Objekt mit hängenden Stunden wirkt günstiger, als es ist"),
never a threshold. A tap pipeline outage, a truncated payload and a pre-go-live month all
produce this picture.

### W2 · `/payroll/`'s unconditional rate caveat now ships **inside a closed disclosure**
`docs/media/look/07-payroll-1680-dark-full.png` · contrast `10-contracts-1680-dark-full.png`

The screen shows a `STUNDENSATZ` column and a `3.874,51 €` total. The sentence that says those
past hours are priced at **today's** rate — `caveatRateHistory`, listed as
*unconditional, may never be deleted* — is the second `<li>` inside
`<details className="callout">` at `web/app/payroll/page.tsx:793`, which ships **closed**,
below the total, behind `▶ WIE DIESE SEITE FUNKTIONIERT`.

The same fact is fully visible on `/contracts/` as `noteLabourNoHistory`. So the copy that
survived is on the screen where nobody pays anybody, and the copy that got folded away is on
the screen where money leaves the building. The constraint for this project is that a caveat
**may move or shrink, never disappear**; a closed `<details>` a director has no reason to open
is a disappearance in practice.

### W3 · `/pl/`'s headline `Ergebnis` silently omits a building's entire labour cost
`docs/media/look/08-pl-1680-dark-full.png`

```
tile 2   Ergebnis  1.531,52 €      caption: "1. Juli 2026 bis 31. Juli 2026."
tile 4   Umsatz    4.610,00 €      caption: "5 Objekte mit eingetragenem Umsatz · 1 fehlt"
```

`4.610,00 − 3.078,48 = 1.531,52`. Aerztezentrum Landstrasse's **796,06 €** of real labour is
not in that `3.078,48`, because the building has no revenue entered and drops out of the
totals whole. Its cost was still incurred. The true result is at most **735,46 €** — the
headline overstates profit by more than 2×.

The screen *knows* the scope: it prints it, on the tile next door. The `Ergebnis` tile carries
no scope caption at all, and the qualification is bullet **9 of 11** in the method list,
~1.400 px further down.

### W4 · `/pl/`'s first number is a zero that means "nothing was measured"
`docs/media/look/08-pl-1680-dark-full.png`

```
Unter der Zielmarge
0
6 Objekte sind nicht beurteilbar
```

Six of six. The `0` is vacuous, and it is the largest, leftmost, first thing on a screen whose
question is "Verdienen wir an diesem Objekt?". The file's own stated rule is that
**"nicht beurteilbar" is not a pass** — and the tile presents it as one. Meanwhile
Ordination Gumpendorf is running at **−84,67 %** four rows below, labelled
`Nicht beurteilbar – keine Zielmarge gesetzt`.

`app_settings` ships empty and nothing defaults the baseline, so **this is the state of
production today**: the P&L flags nothing, for ever, and says `0`.

### W5 · `/pl/` prices unknown material at zero; `/inventory/` refuses to
`docs/media/look/s13-pl-flagged-1680-dark.png` · `docs/media/look/s14-inventory-unpriced-1680-dark.png`

Same fact, two screens, opposite rules:

```
/inventory/   an item nobody priced   ->  "Kein Preis hinterlegt"   (italic, never 0,00 €)
/pl/          the same items          ->  "Material 0,00 €, das sind 0,00 % des Umsatzes."
```

And on `/pl/` that `0,00 €` is not a display choice — it is subtracted, and it appears inside
the **reasoning list that argues a building is under target**. The reason is real
(`0 bepreiste Anforderungen`) and it is stated, in bullet 6 of 11.

### W6 · `/payroll/` on an empty ledger asserts a confident `0,00 €` and two claims about nothing
`docs/media/look/s29-payroll-empty-db-1680-dark.png`

```
Auszuzahlen  0,00 €
· "Keine Schicht in diesem Zeitraum ist offen … aus diesen Gründen fehlt nichts."
· "Die hier geladenen Schichten ergeben genau die Summe des Servers … es fehlt nichts."
```

There are no shifts at all, in any period. Both reassurances are vacuously true and read as
"your payroll is complete". `/shifts/` already suppresses `noneBlocked` when the table is empty
for precisely this reason; `/payroll/` does not. Five checks in this repo have passed vacuously
over zero rows — now the screen does too.

### W7 · `/tags/` prints UTC, and can therefore show the wrong day
`docs/media/look/s02-tags-rows-1680-dark.png`

```
Gemeldet am
2026-08-17T23:05:38.346Z
```

Raw ISO, Zulu, milliseconds. Every other boundary in this product pins `Europe/Vienna`
explicitly. A tag reported between **00:00 and 02:00 Vienna time** — which is when a night
crew mounts cards — displays as the **previous calendar day**. The director matching a
report against "who was in the stairwell last night" is reading a different date than the
operator lived.

---

# 2 · CONFUSING — it costs him time, every day

### C1 · `/tags/` has no way in
`docs/media/look/14-tags-1680-dark-fold.png`

`CORE-FLOW.md` § 4 step 5 — the phone script, the thing he reads in the stairwell — says:

> Admin panel → `Unzugeordnete Tags`.

There is no such entry. `/tags/` is not in `PRIMARY_NAV` and nothing anywhere links to it
(grep: the only occurrence of the path outside the page is a comment saying so). The final
step of the whole write→report→resolve chain is reachable only by typing a URL. `/operators/`
at least has one grey link, in the panel header of `/workers/`.

### C2 · The phone says `Betreiber`; the admin says `Operator`
`docs/media/look/13-operators-1680-dark-full.png`

```
android/…/strings.xml   "Betreiber-Code" · "nicht als Betreiber angemeldet"
web/messages/de.json    heading "Operatoren" · "Operator anlegen" · "Zugangscode"
```

Two words for one role, and they are the two ends of the one procedure the owner has to run by
hand. `Betreiber` is also the correct Austrian business German; `Operator` is a loan word from
the code.

### C3 · `/tags/` identifies a card by a 36-character UUID; the phone identifies it by six
`docs/media/look/s02-tags-rows-1680-dark.png`

```
admin    a7c40e19-52d8-4b63-8f05-9b71c3ea2d40
phone    …907ec7      (CORE-FLOW § 3: "token 907ec7 = the last six of the LIVE id")
```

The two humans in the loop have no shared handle. There is nothing else on the row to tell one
card from another: no building, no address, no note — only the time it was reported.

### C4 · `/tags/` shows the server's internal error codes to a human
`docs/media/look/s05-tags-server-refusal-1680-dark.png`

```
Abgelehnt: slug_taken
```

snake_case, English, unstyled body text, in a German admin panel. The screen has one other
branch, `Abgelehnt vom Server.`, which says nothing at all. Every other screen in the bundle
maps a status onto a sentence.

### C5 · Offline: the screen says it failed **and** that it is still working, and offers no retry
`docs/media/look/s21-payroll-offline-1680-dark.png`

```
Der Server ist gerade nicht erreichbar. Bitte … versuchen Sie es noch einmal.
[Abrechnungszeitraum: Voriger Monat]
Wird berechnet...
```

`Wird berechnet...` never clears. The instruction "try again" is not attached to a control —
the only ways to retry are changing the period or reloading the page. (Also: `...` here, `…`
everywhere else.)

### C6 · 401 drops him on a blank sign-in card with no explanation
`docs/media/look/s24-payroll-401-1680-dark.png`

The contract holds — a dead session does **not** render an empty table that reads as "no data",
the redirect is clean, and that is right. But he was reading payroll and is now looking at an
empty `Anmelden` form with no "Ihre Sitzung ist abgelaufen", and his selected period is gone.
The first conclusion available to him is that he clicked something wrong.

### C7 · The tag URI — "the single most load-bearing control on the screen" — is unreadable
`docs/media/look/s15-locations-tag-open-1680-dark.png`

Opened, in a 175 px column, it wraps four times:

```
https://timesheets.e
xe.xyz/t?l=a9d7531c-
d057-4c99-9e03-
a12da4735bf3
```

The UUID contains real hyphens, and the wrap points look identical to them. Anyone
transcribing this by eye cannot tell which hyphens are in the string. There **is** a copy
button (the safe path) — but the permanent callout at the top of the screen still says
*"Die unten stehende Tag-URL genau so auf den NFC-Tag des Objekts schreiben"*, which is both
an instruction to transcribe and, since the Android tag writer mints the id itself, stale
procedure sitting above the first datum on the screen.

### C8 · Italic means "there is nothing here" on every screen except where it means a fact
`docs/media/look/02-shifts-1680-dark-fold.png`

```
Noch kein Ende      italic muted   = absent
Läuft noch          italic muted   = absent
Keine Nummer …      italic muted   = absent
Am Tag gescannt     italic muted   = A REAL VALUE, the whole audit distinction
```

`ART DER ERFASSUNG` is how payroll tells a tapped shift from a hand-typed one. It is typeset
as an absence, in every row.

### C9 · `unbekannt` next to a euro amount does not mean the amount
`docs/media/look/08-pl-1680-dark-full.png`

```
Eingetragen 18.08. · unbekannt          <- who entered it
Geändert 18.08. · vorher 1.250,00 €
```

Sitting one column from `ERHALTEN 1.380,00 €`, in a screen whose whole vocabulary of doubt is
`Nicht eingetragen` / `unbekannt` / `Nicht berechenbar`.

### C10 · Row actions look exactly like row data
`docs/media/look/05-locations-1680-dark-full.png` · `docs/media/look/12-inventory-1680-dark-full.png`

`.btn-quiet` renders with no border, no fill and body colour. On `/locations/` a row carries
four of them — `Zonen verwalten`, `Mit Lena Hofbauer teilen`, `Bearbeiten`, `Deaktivieren` —
interleaved with plain text cells that look identical. `Mit Lena Hofbauer teilen` in
particular reads as a status ("shared with Lena Hofbauer"), not as a button that mints a link
for an outsider.

### C11 · `/analytics/` never answers its own question
`docs/media/look/11-analytics-1680-dark-full.png`

`Wo geht die Zeit hin?` — and the screen offers six rows, no total, no ranking, no share. The
`KARTE` column repeats `Auf der Karte, verortet am 1. August 2026` five times. Five of six
buildings are trending **up** by 4:45–6:45 a month and that is stated as prose in a table cell.

### C12 · Two notations for one quantity
`docs/media/look/07-payroll-1680-dark-full.png` · `docs/media/look/02-shifts-1680-dark-fold.png`

```
/payroll/    STUNDEN        45,75      decimal hours
/shifts/     DAUER (STD:MIN) 2:45      hours:minutes
```

`45,75` and `45:75` are one keystroke apart in a head doing arithmetic, and `17,50` is
seventeen and a half hours, not seventeen fifty. The payroll column header carries no unit.

### C13 · German: `Kunden anlegen` for one client
`docs/media/look/06-clients-1680-dark-full.png`

`clientCreateHeading` = **"Kunden anlegen"**, `clientEditHeading` = **"Kunden bearbeiten"** —
plural, including as the drawer title while editing exactly one. Every sibling screen is
singular: `Objekt anlegen`, `Mitarbeiter anlegen`, `Operator anlegen`, `Eintrag anlegen`.

---

# 3 · UGLY — cheap, and it makes the product look homemade

### U1 · Every money and duration column is **left**-aligned, and the CSS says it should not be
`docs/media/look/07-payroll-1680-dark-full.png`

```css
/* globals.css:634 */ .data-table th, .data-table td { text-align: left }   /* (0,1,1) */
/* globals.css:770 */ /* "Amounts and durations line up on the decimal so a column can be
                          scanned and totalled by eye." */
/* globals.css:773 */ .col-numeric { text-align: right }                    /* (0,1,0) — loses */
```

Measured in the browser: every `.col-numeric` cell on `/payroll/` computes `text-align: left`.
`236,25 €` and `3.874,51 €` share a left edge, so the decimal points do not line up and
`tabular-nums` — which *is* applied — buys nothing. The rule has been dead for as long as the
comment above it has been describing what it was meant to do.

### U2 · Every in-cell button sits 8 px below the row it belongs to
`docs/media/look/12-inventory-1680-dark-full.png`

Measured: row 1 data at `top: 256`, its `Bearbeiten` button at `top: 264`; row 2 at `307` and
`316`. `vertical-align: top` on the cell plus the button's own padding. It is on every table on
every screen, so the eye reads a permanent half-line stagger down the right of the product.

### U3 · The roster's name column has three different left edges
`docs/media/look/04-workers-1680-dark-full.png`

The worker's name is the label of a `.btn-quiet`, which centres it. So `NAME` (header) starts
at 307 px, `Ana Ilic` at 320, and `Andrea Steiner` — wrapping to two centred lines — at 328.
The identity column of the payroll roster is ragged on the left.

### U4 · `/analytics/` draws a button on top of the sentence it belongs to
`docs/media/look/11-analytics-1680-dark-full.png`

```
Nie verortet – keine Adresse, oder es hat noch niemand danach
gefragt[ Erneut verorten ]
```

The full stop is behind the button's left border.

### U5 · At 1280 the brand wraps to two lines
`docs/media/look/05-locations-1280-dark-full.png` · `docs/media/look/07-payroll-1280-light-full.png`

`NFC` / `TimeSheets` stacked, with `Admin` floating beside the first line. Both themes, every
screen. 1280×800 is the default of a 13" MacBook Air.

### U6 · At 1280 `/locations/` collapses into a ribbon
`docs/media/look/05-locations-1280-dark-full.png`

`VERTRAG UND ZEIT IM GEWÄHLTEN MONAT` becomes a ~100 px column carrying twelve lines of prose
per building; `850,00 € pro Monat` wraps mid-phrase under an underline; rows reach 350 px; the
page grows 1802 → 2347 px for the same six buildings.

### U7 · `/tags/` is unstyled browser default, inside a dark theme
`docs/media/look/s02-tags-rows-1680-dark.png`

`<table border={1}>`, centred bold headers, doubled borders, and — in dark mode — **light grey
OS text inputs and grey OS push buttons**. No `PageHeader`, no question line, no `next-intl`
(decision-8: no hardcoded user-visible strings), no `EmptyState`. The file says all of this
about itself, on purpose. It is still what the director sees.

### U8 · `/material-requests/` has five accents in one column
`docs/media/look/03-materials-1680-dark-full.png`

Five filled blue buttons stacked vertically. The rule is one accent per screen — the primary
action, or the live state. Desaturated (`docs/media/look/grey/03-materials-1680-dark-full-grey.png`)
the column becomes five light slabs and is *more* dominant, not less.

### U9 · A badge that is true of 100 % of rows
`docs/media/look/12-inventory-1680-dark-full.png`

`Im Einsatz` on all nine rows, in a column of its own, beside `Nicht mehr im Einsatz` written
out nine times.

### U10 · Two-line code cells with an inconsistent indent
`docs/media/look/04-workers-1680-dark-full.png` · `docs/media/look/s08-operators-fresh-code-1680-dark.png`

`Kein Zugangscode` on line 1, `Zugangscode erstellen` on line 2, indented ~10 px further right
than the line above it, ×7 on `/workers/` and ×3 on `/operators/`.

### U11 · `/pl/` stacks three links down 130 px
`docs/media/look/s13-pl-flagged-1680-dark.png`

`Objektpanel öffnen` / `Vertrag prüfen` / `Schichten prüfen`, one per line, ~52 px apart, per
flagged building.

### U12 · Duplicated sentences
- `/shifts/`: `Angezeigt wird 23. Juli 2026 bis 21. August 2026.` twice, 150 px apart —
  in the stat tile and under the period select. `docs/media/look/02-shifts-1680-dark-fold.png`
- `/operators/`: the standing "shown only once" note and the fresh-code panel's own
  "shown only once" line, 200 px apart, in two near-identical blue panels — so the one that
  contains a secret does not stand out from the one that is always there.
  `docs/media/look/s08-operators-fresh-code-1680-dark.png`

### U13 · An orphan paragraph, hard-wrapped at ~410 px in a 1360 px column
`docs/media/look/01-home-1680-dark-bottom.png`

*"Alle aktiven Mitarbeiter haben eine Anmeldeadresse hinterlegt. Zu jedem aktiven Objekt ist
mindestens eine Schicht erfasst."* — no heading, no container, floating between two panels at
a measure nothing else on the page uses.

### U14 · The home map's pin labels collide
`docs/media/look/01-home-1680-dark-fold.png`

At 1680, three of five labels overlap into an unreadable stack over Floridsdorf. Four of the
five read `0 vor Ort`, so ~370 px of vertical space is spent to say "nobody is anywhere".

### U15 · Empty panels with 110 px of dead space
`docs/media/look/08-pl-1680-dark-full.png` — `OBJEKTE UNTER DER ZIELMARGE` holding two lines of
text. `docs/media/look/s38-home-empty-1680-dark.png` — a fresh install is ~1.600 px of empty
containers holding five sentences, and says "nothing to do" twice.

### U16 · `/contracts/` heading case
`docs/media/look/10-contracts-1680-dark-full.png` — `Was das löst – und was nicht` in sentence
case among `OBJEKTE` / `ALLE OBJEKTE` in tracked small caps.

---

# 4 · The three questions, one line each

| # | Screen | What question does it answer | What the eye lands on first | Is that the most important thing? |
|---|---|---|---|---|
| 1 | `/` | Muss ich gerade etwas tun? | the numeral **2**, `Zu erledigen` | **Yes.** The best fold in the product. |
| 2 | `/shifts/` | Welche Schichten brauchen eine Entscheidung? | **3**, then **87** at equal weight | Half. `3` is right; `87` counts rows on screen, a fact about the filter, sized like a fact about the business. |
| 3 | `/material-requests/` | Worauf wartet gerade jemand vor Ort? | the column of five blue buttons | No — which button to press depends on the request text to its left (U8). |
| 4 | `/workers/` | Wer arbeitet für uns, und wer kommt noch nicht rein? | a 78-word blue note about enrolment codes | No. The roster is. The note is true and load-bearing; it is not the answer. |
| 5 | `/locations/` | Welche Objekte betreuen wir, und welches Tag gehört dazu? | a blue callout telling him to write a URL onto a card | No — and the instruction is stale procedure (C7). The real news, *every building is under its contracted time*, is sentence three of a prose cell. |
| 6 | `/clients/` | Für wen arbeiten wir, und wen rufe ich dort an? | the blue `Kunden anlegen` button | No, but the list is one line below and cheap to reach. Cleanest table in the product. |
| 7 | `/payroll/` | Was ist diesen Monat auszuzahlen? | **3.874,51 €** | **Yes** — stated without the caveat that qualifies it (W2). |
| 8 | `/pl/` | Verdienen wir an diesem Objekt? | the numeral **0**, `Unter der Zielmarge` | **No.** It is vacuous (W4); the answer (−84,67 % at Ordination Gumpendorf) is 1.100 px below. |
| 9 | `/account/` | Wie ändere ich mein Passwort? | the `Aktuelles Passwort` field | **Yes.** One job, done. |
| 10 | `/contracts/` | Was ist vereinbart, und seit wann? | the `– Objekt wählen –` select | **Yes.** Nothing happens until he picks one. |
| 11 | `/analytics/` | Wo geht die Zeit hin? | `Über der vereinbarten Zeit` **2** | Half — the screen never answers the question it asks (C11). |
| 12 | `/inventory/` | Was haben wir, und was kostet es? | the blue `Eintrag anlegen` button | No, but the price is two columns in. Gets `Kein Preis hinterlegt` exactly right. |
| 13 | `/operators/` | Wer darf Tags lesen und beschreiben? | the blue `Operator anlegen` button, then the standing code note | No — the note swallows the fold for a thing done once a month. |
| 14 | `/tags/` | *(implied)* Welche Karten hat ein Handy geschrieben, die ich noch nicht zugeordnet habe? | the h1, then a 36-character UUID | **No.** The screen has no question line, and its first datum is unmatched to anything physical (C3). |
| — | `/login/` | Wie melde ich mich an? | `Benutzername` | Yes. One failure message, no enumeration oracle. |
| — | `/reinigung/` | Wann wurde mein Objekt zuletzt gereinigt, von wem, wie lange? | the building's own name | Yes. Three fields only, as designed — but **nothing on it names the cleaning company**, so a forwarded link is anonymous, and the failure state says *"wenden Sie sich an Ihre Reinigungsfirma"* without naming one. `docs/media/look/s40-portal-ready-1680-dark.png` |
| — | `404` | — | `Diese Seite gibt es nicht` | Yes, with a way out. |

---

# 5 · Desaturated: what stops being readable without colour

**All 204 screenshots** were desaturated: every `docs/media/look/X.png` has a `hue=s=0` twin at
`docs/media/look/grey/X-grey.png`. What follows is what changed.

**One state fails.**

### `.form-error` desaturates DARKER than the ordinary status line beside it
`docs/media/look/grey/s21-payroll-offline-1680-dark-grey.png`

```
colour     "Der Server ist gerade nicht erreichbar…"   red     #ef4444-ish
           "Wird berechnet..."                         body    #E9EAEC
greyscale  "Der Server ist gerade nicht erreichbar…"   ~#8a8a8a   ← DIMMER
           "Wird berechnet..."                         ~#E9EAEC   ← BRIGHTER
```

Same size, same weight, no icon, no rule, no box. Remove the hue and the failure message reads
as **less** important than the "still working" message under it — the exact inversion. Colour is
the only signal the error has, which is the one thing `DESIGN.md` § 3.4 forbids.

**Everything else passes, and passes for the stated reason: the word is the first signal.**

| Surface | Greyscale verdict |
|---|---|
| shift badges `Läuft` / `Nicht bestätigt` | ✓ word in the pill; the amber and blue left rules collapse into one grey, harmless because the words differ |
| `Zählt zur Bezahlung` / `Zählt nicht zur Bezahlung` | ✓ words, next to every state |
| material stages, all five | ✓ words in the pill and in the summary tiles |
| inactive rows (`/workers/`, `/operators/`, `/locations/`) | ✓ dimmed **and** the word `Inaktiv`. No strikethrough on the name (DESIGN.md § 3.4 asks for one) — not needed, the word carries it |
| `/pl/` assessments, `/inventory/` `Kein Preis hinterlegt`, `/contracts/` `Kein Preis hinterlegt` pill | ✓ words |
| `/material-requests/` five accent buttons | ✓ readable — and *more* dominant in grey than in colour (U8) |
| negative amounts (`−355,61 €`, `−2:30`) | Neutral: they carry no colour to lose, but no first signal either — one `−` glyph is the entire difference between a building that pays and one that does not |

---

# 6 · Things this project has got wrong before — re-checked

| Trap | Verdict |
|---|---|
| a count that counts the wrong noun | **found** — `/shifts/` `Angezeigt 87` (rows on screen) at the weight of `3` (work to do). See § 4 row 2 |
| a figure priced at zero where "nothing to measure" was meant | **found ×4** — W1, W4, W5, W6 |
| a raw internal token shown to a human | **found ×2** — `Abgelehnt: slug_taken` and the bare UUID, both on `/tags/` (C3, C4) |
| a caveat that quietly disappeared | **found** — `caveatRateHistory` into a closed `<details>` (W2) |
| prose above the first datum | **found ×3** — `/workers/` 78 words, `/locations/` a stale tag instruction, `/operators/` the code note (§ 4) |
| card captions vs column headers at 390 px | not re-measured this run — the brief asked for 1680 and 1280. `demo/shoot-ia.mjs` covers 390 and reports clean |
| `/clients/` contact deactivation revoking a portal link silently | **no longer true.** It is now a `ConfirmModal`: *"…alle ihr gegebenen Links … werden sofort beendet. Ein späteres Wiederaktivieren stellt diese Links nicht wieder her."* with the button labelled `Deaktivieren und Links beenden`. The ⚠ in `REDESIGN-INVENTORY.md` § 27 can be closed |
| de/en key parity | ✓ 1232 = 1232, no key on either side alone |
| horizontal overflow, theme drift | ✓ zero across 68 page loads in four configurations |

---

# 7 · What did NOT happen

- **Nothing was fixed.** No file under `web/`, `server/`, `android/` or `NFCTimeSheets/` was
  touched. The only new files are the two capture scripts and this document.
- **Production was not screenshotted.** Every picture is the local static export served by
  `demo/demo-server.mjs` against `nfc_demo`, plus rows this run seeded and deleted again.
  Production holds one building and no meaningful work, so it has no populated screen to look at.
- **390 px was not looked at**, by instruction. The `390px must work` constraint is therefore
  unverified by this run; `demo/shoot-ia.mjs` is what covers it.
- **The client portal's ready state was captured at 1680 only.** The 390 px shot's probe hung
  and was killed; `s41-portal-ready-390-dark.png` does not exist.
- **No warm human browser was used** — headless Chrome with a cold profile, as always. TASK-206's
  open question is untouched by this run.
- **Not judged**: whether any of the above is worth fixing, and in what order beyond cost. That
  is the next phase's call.
- The database was mutated and restored twice; both runs printed
  `database restored, fingerprint MATCHES`. `portal_grants` was left at its original count of 1
  after a hand check.
