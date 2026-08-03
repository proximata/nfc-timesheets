# The admin panel, screen by screen

For the director. No technical knowledge assumed. Written **2026-08-03**, Vienna time.
Everything below was checked against the real live database, not against a description of it.

The panel is at **https://timesheets.exe.xyz** and is built for a **desktop or laptop**. On a
phone it deliberately shows a message instead of the screens — the tables are too wide to be
read safely, and a payroll number that is half off the edge of a phone is worse than no
number.

---

## Read this first — three things are still blocking

### 1. None of the fixes described in this document are live yet

The server running at timesheets.exe.xyz today is the version from **29–30 July**. Everything
in this document is true of the corrected software; it is **not** true of the panel you will
open this afternoon. Until someone deploys, the shift list will still open on "Dieser Monat"
and still look empty.

**Needed:** one deployment. Nothing else.

### 2. There is no backup of your data. There never has been

A nightly database backup is supposed to run at 00:03. It has failed **every single night**.
The backup program cannot get into the folder it lives in — a file-permission mistake made
when the server was first set up.

```
nfc-backup.service   failed (exit 203/EXEC) since Mon 2026-08-03 00:13 UTC
/srv/nfc/ops/backup/pg-backup.sh   drwxr-x--- exedev:app   <- the "postgres" account cannot enter
/var/backups/nfc     Permission denied
```

Right now that is five shifts and one employee, so the loss would be small. It will not stay
small. **If the machine dies today, everything is gone.**

**Needed:** a permissions fix on the server, then confirm one backup file actually appears in
`/var/backups/nfc`. Not a code change. Nobody should run payroll off this system for a full
month until a backup has been seen to work at least once.

### 3. The 8-hour safety timer has never run either

If a cleaner forgets to tap out, a rule is supposed to close the shift automatically after 8
hours and mark it "needs confirming". That job runs every 15 minutes — and fails every 15
minutes, for the same permissions reason:

```
nfc-autoclose.service   failed since Mon 2026-08-03 12:00 UTC
psql: /srv/nfc/ops/sql/autoclose.sql: Permission denied
```

Why this matters more than it looks: a person can only have **one** shift open at a time. If
Ivan forgets to tap out on Tuesday, that shift stays open forever, and on Wednesday **his
phone will refuse to clock him in** at the next building. He is then unpaid and stuck, and
nothing recovers on its own.

**Good news:** you can fix it yourself in under a minute — *Schichten* → *Korrigieren* on that
row → type the real *Ende* → *Speichern*. That is exactly what the screen is for.

**Needed:** the same permissions fix as #2.

---

## Why your five shifts seemed to disappear — and what changed

**They were never lost.** All five were in the database the whole time, and they still are.

What happened is this. Your shifts are all dated **30 July**. You looked at the panel on **3
August**. The shift list opened with the time filter set to **"Dieser Monat"** — meaning
1 August onwards — and 30 July is not in August. So the table was empty. It did not say *why*
it was empty. An empty table and a lost database look exactly the same, so you read it the way
anyone would.

At the same moment the payroll screen showed you **€51.18**. That figure was correct, but it
was calculated over *all time ever*, while the list of shifts next to it was being cut to the
month you had selected. Two different time ranges, side by side, with nothing saying so. That
is the more serious of the two problems: a total that does not describe the rows underneath it
is how somebody eventually gets paid twice, or not at all.

**Three things changed.**

1. **The shift list now opens on "Letzte 30 Tage"** instead of the calendar month. A rolling
   window always contains yesterday. A calendar month, on the 1st of the month, contains
   nothing.

2. **An empty list now explains itself.** If you pick a period with nothing in it, the screen
   says, in words: how many shifts exist *outside* that period, the date of the most recent one,
   and gives you two buttons — *"Alle geladenen Schichten anzeigen"* and *"Stattdessen … anzeigen"*
   — that take you straight to them. The panel now knows the difference between "nobody worked"
   and "your data is gone", and it says which.

3. **Payroll totals and payroll rows are now cut by the same dates.** The server, not the
   browser, decides the period, and it applies that period to the total and the rows in one go.
   They cannot disagree any more. The screen also cross-checks the two and tells you if they
   ever differ.

Proof, using your five real shifts and today's date:

| Period you pick | Shifts shown | Total shown | Do they agree? |
|---|---|---|---|
| Letzte 30 Tage *(the new default)* | 5 | €51.18 | yes |
| Voriger Monat | 5 | €51.18 | yes |
| Dieser Monat | 0 — *plus* "5 shifts exist outside this period, the most recent is 30 July" | €0.00 | yes |
| Dieses Quartal | 5 | €51.18 | yes |

Before the change, the "Dieser Monat" row read: **0 shifts, €51.18**.

---

## Screen by screen

### Übersicht (the front page)

**What it is for:** answering one question — *is anything wrong right now?*

**Shows you:** who is clocked in at this moment and for how long; a short "Zu erledigen" list of
things that will cost you money if ignored (shifts waiting to be confirmed, employees with no
login address, buildings whose tag has never been scanned); and, at the bottom, the **last 10
completed shifts** so you can see at a glance that recording is working at all.

**Deliberately does not show:** hours, money, charts, or totals of any kind. This page is an
alarm, not a report. If it started showing "hours this month", then on the 3rd of a month it
would read €0.00 and frighten you for no reason — which is precisely what happened. The
recent-shifts list at the bottom has **no date filter and no total**; it cannot be wrong,
because it has no boundary to get wrong.

**For anything else:** *Schichten* for the full record, *Lohnabrechnung* for money.

### Schichten (shifts)

**What it is for:** the complete record of every clock-in and clock-out, and the only place to
correct one.

**Shows you:** every shift with employee, building, start, end, duration, and — in plain words,
not colours — its state: *Offen*, *Zu bestätigen*, *Bestätigt*, *Abgeschlossen*. Each row also
says whether it counts towards pay yet. A separate column says whether the shift was **tapped on
a tag** or **typed in by hand**, because payroll gets audited and those two must never look
alike.

**You can:** filter by employee, building and period; correct a shift's times, employee or
building; and file a shift by hand when someone's phone was dead or a tag was missing.

**Deliberately does not show:** money. Hours here are hours; what they are worth is one screen
over, so that a change of hourly rate can never quietly rewrite a shift record.

**All times on this screen are Vienna time**, and the screen says so, regardless of where the
computer you are using thinks it is.

**One hazard, not yet fixed:** if you clear the *Ende* field on a finished shift and save, that
shift becomes "open" again. It leaves payroll, and it occupies that person's one open-shift slot
so their phone will not let them clock in. There is currently **no confirmation prompt**. Do not
empty the *Ende* field unless you mean to.

### Mitarbeiter (employees)

**What it is for:** the people who record hours, and what they are paid per hour.

**Shows you:** name, e-mail address, phone number, hourly rate, active/inactive.

**Important:** the **e-mail address is the app login** and must match exactly what Apple sends.
The phone number is a contact detail and grants nothing. Deactivating a person immediately ends
their app session; nothing is ever deleted, so their past shifts stay readable.

**Deliberately does not show:** their hours or their pay. That is *Lohnabrechnung*.

**Known limitation:** only **one** hourly rate is stored per person. There is no history. If you
raise Ivan's rate today, last month's hours are re-valued at the new rate the next time you open
the payroll screen. The payroll screen states this on itself, every time.

### Objekte (buildings)

**What it is for:** the buildings you clean, the NFC tag URL for each, and the contract terms.

**Shows you:** name and address, which client and which contact person it belongs to, the
monthly contract amount, the agreed monthly hours, the time actually worked in a month you
choose, the tag URL, and the client link.

**New:** there is now a **month picker**. Previously this column was locked to the current
calendar month, so on the 3rd of the month every building read `0:00` and — where you had agreed
monthly hours — the screen stated *"40:00 unter der Sollzeit"*, which was a false statement about
a contract. You can now look at any month.

**Deliberately does not show:** individual shifts. Click through to *Schichten* for those.

**Note on Deaktivieren:** standing a building down now **immediately revokes any client link**
for it. Someone at a client company should not keep reading the cleaning history of a building
you no longer clean. Reactivating does not restore the old link — issue a fresh one.

### Kunden (clients and contacts)

**What it is for:** the companies you have contracts with, and the person at each one you report
to.

**Shows you:** each client, its contacts, and how many buildings each covers. You can create
both directly while adding a building; this screen exists mainly for corrections later.

**Important:** a contact is **not a login**. They have no password and no account. The only
access they ever get is a link you send them. **Deactivating a contact ends every link you gave
them, immediately** — that is intentional, for someone who has left the client company.

### Lohnabrechnung (payroll)

**What it is for:** what to actually pay each person for a period.

**Shows you:** hours and amount per person for the chosen period, a total, and a **"Vor der
Auszahlung"** box listing everything that is *not* in that total and why. Nothing is ever
excluded silently. It also cross-checks its own total against the server's and tells you if the
two ever differ.

**You can:** export a CSV for your accountant. It opens correctly in Austrian Excel, includes the
amounts in whole cents as well as euros, and records how many of the paid shifts were typed in by
hand.

**What is left out of the total, always, and named on screen:**

- shifts still open (nobody has tapped out yet);
- shifts the 8-hour timer closed that **no human has confirmed**. A "start plus 8 hours" guess is
  a placeholder, not hours worked, and it must never turn into money on its own. Confirm it in
  *Schichten* and it counts from that moment.

**Deliberately does not show:** anything about buildings, clients or contracts. Money owed to
people, and nothing else.

**One small thing worth knowing:** each period is priced once, so adding two shorter periods
together can differ from the single longer period by a cent. Run payroll for the period you are
paying — do not add two of them up.

### Produkte & Geräte (inventory)

**What it is for:** a catalogue of what the teams use and what one unit costs.

**Shows you:** name, whether it is a consumable product or a reusable device, and unit cost.

**Deliberately does not show — and this is a real gap:** there is nothing here that records *how
much was used, where*. It is a price list, not a stock system. See below.

### Reinigungsnachweis (the client's own page)

Not part of your navigation. It is the page a client's contact sees when you send them a link
from the *Objekte* screen. It shows one building, the dates it was cleaned, the cleaner's **first
name only**, and the duration. No surnames, no rates, no other buildings.

The full link is shown to you **exactly once**, when you create it. Copy it then. Creating a new
one for the same person and building automatically cancels the previous one, so nobody ends up
holding two.

---

## What the panel cannot do at all

These are not bugs. They do not exist yet, and knowing that is worth more than discovering it at
month end.

1. **Material and equipment costs are not attributed to anything.** *Produkte & Geräte* is a
   price list. There is no record of what was used at which building, so there is no cost per
   building and no profit-and-loss figure. The four locked menu items — *Materialanforderungen*,
   *Gewinn & Verlust*, *Vertragsverwaltung*, *Objektauswertung* — are exactly this, and they are
   marked "Kommt später".

2. **No history of hourly rates.** One rate per person, ever. Changing it changes what the past
   appears to have cost.

3. **Nothing can be deleted.** Employees, buildings, clients, contacts and inventory items can
   only be made inactive. This is on purpose — past shifts point at those rows and must stay
   readable — but it means the lists get longer, never shorter.

4. **You cannot add or remove an admin, or change your own password, from the panel.** That is
   done on the server by whoever administers it.

5. **You cannot write the NFC tags from here.** The panel shows you the correct URL for each
   building; putting it onto the plastic tag is done with a tag-writing app on a phone.

6. **There is no record of who changed what.** If a shift is corrected, the corrected values are
   stored, but not which admin did it or when — beyond the fact that a correction happened.

7. **No mobile or tablet layout.** Desktop or laptop only, by design.

8. **The panel cannot tell you whether the backup ran.** See blocking item #2 — today it has not.

9. **You cannot see cancelled client links.** Only live ones are listed. A cancelled link is
   history you cannot act on, so it is not shown.

---

## Small rough edges, none of them dangerous

- On **Safari**, the month picker on *Objekte* appears as a plain text box rather than a calendar.
  Type the month as `2026-07`; the hint under the field says so. Other browsers show a picker.
- The dashboard's activity block is headed *"die letzten 10"* even when there are fewer than ten
  shifts to show. It is a cap, not a count.
- *Lohnabrechnung* offers "Letzte 30 Tage" as a period. It is useful for a quick look, but it is a
  rolling window and not a pay period — pay against *Voriger Monat* or *Dieser Monat*.

---

## How this was verified

Not by reading the code and hoping. The real five shifts were copied out of the live database
into a real database, the real server was started against it, and the real screens' own
calculation files were run over the result.

```
E2E, real server + real Postgres, the five live shifts:
  thisMonth    rows=0  serverTotal=EUR 0.00   rowsSum=EUR 0.00   agree=true
  lastMonth    rows=5  serverTotal=EUR 51.18  rowsSum=EUR 51.18  agree=true
  last30Days   rows=5  serverTotal=EUR 51.18  rowsSum=EUR 51.18  agree=true
  thisQuarter  rows=5  serverTotal=EUR 51.18  rowsSum=EUR 51.18  agree=true
  thisYear     rows=5  serverTotal=EUR 51.18  rowsSum=EUR 51.18  agree=true
  ok  no date range behaves exactly as before  (the iPhone app is unaffected)
  ok  a shift lands in exactly one Vienna month
  ok  a period crossing the October clock change keeps its last evening
  ok  garbage dates are refused, never silently ignored
  ok  a shift the timer closed and nobody confirmed earns nothing
  ok  amounts are whole cents everywhere

server: check-api PASS (94 checks)     web: 14 checks, lint, types, build — all pass
```
