# The Admin Panel — What You Can Do Now

Written for the person running the cleaning company, not for a developer.
Everything below was tested against a real database and a real running server.

---

## Read this first — two things need your decision before the panel goes live

### 1. The panel will open in ENGLISH unless someone flips a switch

All the new screens — buildings, clients, products & equipment, the missed-shift form — are
fully in German. But the panel is currently **built to start in English**. There is a language
picker in the top corner and switching it to Deutsch works and is remembered on your computer,
so you can use German today with one click, once, per computer.

If you want German to be the starting language, someone has to set one setting before the next
upload (`NEXT_PUBLIC_DEFAULT_LOCALE=de`). **We did not flip it for you, because right now that
would give you a half-and-half panel**, and you should choose which you'd rather have:

| | Leave as is (English start) | Flip to German start |
|---|---|---|
| New screens (buildings, clients, products, missed shift) | German after one click | German |
| Left-hand menu | English: Dashboard, Shifts, Workers, Locations, Payroll | Still English for those five |
| Sign-in screen | English | Still English |
| Error messages ("could not reach the server") | English | Still English |
| The client's own page | **Always German**, never anything else | Always German |

The sign-in screen, the five old menu entries and the error messages were never translated —
that was agreed in advance as a separate, later job (decision-8 / decision-17), and this round
did not include it. It is about 48 short sentences and needs no programming.

**Our recommendation:** have those 48 sentences translated, then flip the switch, and the whole
panel is German in one go. Until then, click Deutsch once per computer.

### 2. Two German words are used for the same thing

The buildings screen calls a building an **Objekt**; the shifts screen and the client's page
call the same thing a **Gebäude**. Likewise the menu says **Kunde** while the forms say
**Unternehmen** for the same company. Nothing is broken and no data is affected — it is a
wording clean-up that belongs with the translation job above. We deliberately left it alone
rather than rewrite 43 German sentences without a native speaker checking them.

Nothing else is blocking. Everything below works.

---

## What you asked for, and what you got

| You asked for | Status | Where |
|---|---|---|
| Buildings: **name** | Done | Buildings screen, "Objektname" |
| Buildings: **address** | Done | Buildings screen, "Adresse" |
| Buildings: **point of contact** | Done | "Ansprechperson beim Kunden" — pick one, or create one right there |
| Buildings: **company with which contract** | Done | "Kunde – das Unternehmen, mit dem der Vertrag besteht" — pick, or create right there |
| Buildings: **monthly contract volume** | Done | "Vertragsvolumen pro Monat", in euros |
| Buildings: **target time spent** | Done | "Sollzeit pro Monat", in whole hours |
| Cleaners: **name** | Already existed, kept | Workers screen |
| Cleaners: **phone** | Done | "Telefonnummer (nur zum Anrufen)" |
| Cleaners: email + hourly rate | Untouched, still there | Workers screen |
| Inventory: **products and equipment, each with a cost** | Done | New screen "Produkte & Geräte" — one list, you pick Produkt or Gerät per entry |
| Client access: **when last cleaned** | Done | The link you send them |
| Client access: **who cleaned — FIRST NAME ONLY** | Done | Surname is not sent to their page at all |
| Client access: **how long** | Done | Shown as hours:minutes |

Plus one thing you did not ask for but needed: **a way to record a shift a cleaner's phone
failed to record.** Without it a real day worked gets paid €0. It is on the Shifts screen and
every such shift is permanently marked "Manuell erfasst" so it can never be mistaken for a
real tag reading.

---

## Adding your first client, building, contact and inventory item

You never have to set anything up in advance. Start with the building; the company and the
person can be typed in on the same screen.

### The building (and, in the same breath, the company and the person)

1. Left menu → **Locations / Objekte**.
2. Fill in the name of the building and its address.
3. **Kurzkürzel** — a short handle, lower-case, no spaces, e.g. `neuhaus-15`. It is only a
   label for your own lists. It has to be different for every building.
4. **Kunde** — open the dropdown. If the company is not in the list yet, choose
   **„+ Neues Unternehmen…“** and type its name in the field that appears. No separate screen,
   no saving in between.
5. **Ansprechperson** — same idea: choose **„+ Neue Ansprechperson…“** and type their name.
   Their e-mail and phone are optional and are only so *you* can recognise and reach them.
   **They are not a login. Nobody signs in with them.**
6. **Vertragsvolumen pro Monat** — what you invoice for this building each month, in euros:
   `1200` or `1200.50`. Leave it empty if you do not know it yet; empty and 0 are treated as
   different answers and empty is never turned into 0.
7. **Sollzeit pro Monat** — how many hours a month it is supposed to take: `40`. Whole hours.
   Leave it empty if nothing was agreed.
8. **Objekt anlegen.**

The company and the person are created together with the building, in that order. If the save
then fails because the Kurzkürzel is already taken, pressing Save again will **not** create a
second copy of the company or the person — the form remembers what it already created.

You can leave the contract figures empty and come back to any building later. Filling them in
over weeks, building by building, is expected and nothing stops working in the meantime.

Once a building has a contract figure and a target, its row reads it back to you in plain
words: e.g. `1 200,50 € pro Monat`, then how many hours were actually worked this month,
the target, and how far under or over you are. Open shifts and unconfirmed timer shifts are
counted separately as "pending" and never quietly folded into the hours.

### A cleaner

1. Left menu → **Workers / Mitarbeiter**.
2. Name, and the phone number under **„Telefonnummer (nur zum Anrufen)“**.
3. Leave the e-mail address alone unless you are giving that person the phone app — **the
   e-mail is the app sign-in, the phone number is not and never will be.** A phone number
   typed into the e-mail field will not let anyone in.

### A product or a piece of equipment

1. Left menu → **Produkte & Geräte**.
2. Name it (`Bodenreiniger 5 l`, `Staubsauger`).
3. **Art** — Produkt if it gets used up, Gerät if it stays and gets reused. One list, one
   screen; the word is the only difference.
4. **Kosten pro Stück** in euros, e.g. `4,90`. Leave it empty if it is not priced yet — the
   list will then say "Kein Preis erfasst" rather than "€0,00", because €0,00 would be a lie
   that later flows into a cost calculation.

### A shift nobody's phone recorded

1. Left menu → **Shifts / Schichten** → the form above the list.
2. Choose the cleaner and the building. **Nothing is pre-selected on purpose** — a
   pre-selected name is a wrong payslip.
3. Type start and end. Both are required; you cannot leave a shift running from here.
   **All times on that screen are Vienna time**, and it says so on screen.
4. Save. The row appears with **"Manuell erfasst"** under *Art der Erfassung*; tag readings
   say *"Am Tag eingelesen"*. That marking is permanent and cannot be removed.

If that person is already recorded somewhere else in that time window, the panel refuses and
tells you where, by name: *"Anna ist bereits erfasst: Neuhaus 15, 15. Jan 09:00 bis 13:00."*
A shift ending before it starts, and a shift in the future, are also refused.

**Payroll now counts these.** The Payroll screen says how many of the shifts in a total were
typed in rather than tapped, with a link to see which ones, and the same number is a column in
the CSV your accountant gets. They are paid in full — the count is there so a dispute has an
answer.

---

## Sharing a building with the client's contact person, and stopping it

### To share

On the buildings list, the row has a button reading **„Mit Eva Gruber teilen“** — the actual
person's name, so you can see who you are about to give access to.

Press it and the link appears once, above the table, with a **„Link kopieren“** button and two
sentences saying exactly what the holder will be able to see.

**Copy it there and then. It is shown only once and cannot be looked up again.** Send it by
e-mail or WhatsApp. That is the whole thing — the contact does not register, does not get a
password and does not install anything.

If you lose the link, press **„Neuer Link“** on that row. That issues a fresh one and kills
the old one immediately. Losing a link costs you nothing.

Each person has exactly one working link per building, always.

### To stop sharing

Press **„Teilen beenden“** in the same row. It takes effect immediately — the next time anyone
opens that link, including someone it was forwarded to, they get "this link does not work".

It also stops by itself when you deactivate that contact person, or deactivate the building.
You do not have to remember to revoke separately.

If the button is not offered, the row says why in words — no contact person yet, the contact
is no longer active, or the building is switched off.

### What the client actually sees

The building's name, and a table with three columns and nothing else:

| Datum | Gereinigt von | Dauer |
|---|---|---|
| Do., 30.07.2026 | Anna | 2:00 Std. |

Up to the last 20 completed cleanings, newest first. In German, and it works on a phone.

**What they cannot see, tested field by field:** your cleaner's surname, e-mail address, phone
number or hourly rate; any other building; any company name, including their own; any contract
figure; anything from Products & Equipment; and no internal numbers of any kind, so there is
nothing for them to change in the address bar to see something else. A cleaning the 8-hour
timer guessed at and nobody has confirmed is not shown either — telling a client "we cleaned
for 8 hours" when you do not know that is worse than showing nothing.

**Assume the link gets forwarded.** That is the trade for the client not needing an account,
and it is why the page shows so little. Anyone holding it sees that one building's cleaning
list. Press "Teilen beenden" and it is dead.

One caveat to be honest about: the link is not secret from your own hosting provider's logs in
the way a password would be. Our own server never writes it down anywhere. Treat it as
"anyone with this link can read this", not as a password.

---

## Still missing

- **Translation of the sign-in screen, the five old menu entries and the error messages** — the
  blocking item at the top. About 48 short sentences, no programming.
- **One German word per thing** — Objekt vs Gebäude, Kunde vs Unternehmen. Same job as above.
- **Nothing uses the inventory costs yet.** You can record products and equipment and their
  cost, which is what you asked for, but nothing yet spreads those costs across buildings or
  tells you what a building's materials cost. That is the next piece of work
  (decision-6: split pro-rata by hours worked).
- **No profit figure per building.** You can see contract amount and hours worked side by side
  and do the subtraction yourself; the panel does not yet do it for you.
- **The panel is desktop only, on purpose.** On a phone or a narrow window it shows "please
  open this on a computer" (in English, see above). The client's page is the one exception —
  that one is built for a phone, because that is where they will open it.
- **The month filter on the shifts and payroll screens still uses your computer's clock**, not
  Vienna's. It only matters if you work from a laptop set to another country's time zone at
  midnight on the 1st of a month. The shift times themselves are always Vienna time.
- **Only one person can see a building's history per contact.** If a client wants two people to
  see it, add both people and send each their own link.
- **No e-mail is sent by the system.** Links are copied and sent by you.

---

## For the technical record

Verified on disk, not from anyone's report:

- Admin panel builds clean and exports 11 static pages. Every menu link resolves to a real
  page — no dead links. Type checking, linting and the i18n parity check all pass.
- All four server checks pass: the API self-check (77 cases), the migration check, the
  auto-close flag check and the Apple-site-association check.
- Migration 003 was applied to a database shaped like production (001 + 002 already applied,
  with a closed shift and an open shift in it). Existing cleaners and buildings survived with
  the new columns empty; re-running the migration did nothing, as required.
- Client portal, tested live: the link is stored only as an irreversible hash, never as itself;
  a cancelled link and a made-up link give byte-identical answers including headers; the page
  is rate-limited and locks out after 5 misses; a made-up link never reaches the database; the
  link never appears in any server log. The response contains three fields and no others.
- `POST /admin/shifts` cannot create a backwards, future, open, exactly-overlapping or
  partly-overlapping shift, including against a shift that is still running, and refuses an
  inactive cleaner or building. Back-to-back shifts are allowed.
- Money is integer cents and time is integer minutes at every new boundary. No amount is ever
  multiplied as a decimal. `1.005 €` is rejected as unclear rather than silently rounded.
- Vienna time was checked on both daylight-saving changeover days, across midnight and across a
  month boundary, with the host computer set to Vienna, UTC, Auckland and Los Angeles: the same
  answer every time, and always the right calendar day.
- Every new form control has a label; tables have scoped headers and captions; every status is
  written in words, never colour alone; everything clickable is a real keyboard-reachable
  button.
- No new software dependency was added. The server still depends on exactly one package (`pg`).
  Nothing in the iPhone app was touched.

Two things were repaired during this review:

- The client's page was serving a browser-tab title reading *"NFC TimeSheets Admin"* to
  outsiders before the page loaded. It now reads *"Reinigungsnachweis"*
  (`web/app/reinigung/layout.tsx`).
- The Payroll screen could not tell a typed-in shift from a tag reading. It now counts them,
  links to them and includes them as a CSV column (`web/lib/payroll.ts`,
  `web/app/payroll/page.tsx`).
