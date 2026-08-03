# The four new screens, the Android app, and what you have to do

For the director. No technical knowledge assumed. Written **2026-08-03**, Vienna time.

Everything in this document was checked against a real database, a real browser and the real
live server — not against a description of one. Where a report and the software disagreed, the
software won, and where I could not check something I say so instead of guessing.

---

## Read this first — seven things are blocking, in this order

### 1. None of this is live. Not one of the four screens works this afternoon.

The server at timesheets.exe.xyz is still running the older version. I asked it directly for two
of the new addresses and it answered "no such thing" to both. Its database is still at update 4;
the new one is update 5 and has never been applied there.

**What it needs:** one deployment. Nothing else, and nothing about it is risky — I applied
update 5 to a throwaway copy of the real live database, on the same version of the database
software the server uses, and it went on cleanly and left every existing record alone.

**Until that deployment happens, everything below describes software that exists but that nobody
can open.**

### 2. The map will be blank in production, even after the deployment

There is a Google Maps key and it works — I tested it and drew a real map with it. But the
script that publishes the site does not hand the key to the site while building it. It passes
one setting (the language) and not this one.

So the published site will come out with no key inside it, show the words *"this build contains
no Google Maps key, so no map is drawn — everything the map would show is in the table below"*,
and the table underneath will still list every building. Usable, honest, and not what you want.

**What it needs:** one line added to the publishing script. This is a five-minute job for
whoever does the deployment, but **it is not in the part of the project this work was allowed to
change**, so it has been left for them rather than done half-way.

### 3. No building photographs will ever appear, until you tick one box

The screens are built to show a Street View photograph of each building. They will not show one.

I asked Google directly, with your real key, while writing this. The answer was:

> REQUEST_DENIED — This API key is not authorized to use this service or API.

The "Street View Static API" is switched **off** for your Google account. The map itself works;
this is a separate switch on the same page.

**What you must do:** in the Google Cloud Console, enable **Street View Static API**. Nothing in
the software has to change — photographs start appearing the day you tick it. Until then every
building says, in German, that Google refused the request and why. Nothing is faked and no grey
placeholder is passed off as a photograph.

### 4. Buildings will not get map pins, because the server has not been given the key

There are two Google keys: one for the browser (the map) and one for the server (turning
"Testgasse 1, 1010 Wien" into a point on the map). The second one is not installed on the
server. I checked — it is not there.

Every building you save will be saved correctly and will simply have no pin, and the screen will
say **"no key"** rather than pretending it tried. The existing building (HOIV) has no pin today
for the same reason.

**What it needs:** the key added to the server's settings file, then a one-command catch-up run
that goes through existing buildings and finds their coordinates. Again: not in the part of the
project this work could change.

### 5. The profit figures will flag nothing until you set one number

This is deliberate and I want to be sure it does not read as a fault.

The software does not decide what a good profit margin is for a Viennese cleaning contract. That
is your judgement, not a programmer's. So the target margin ships **empty**, and while it is
empty every building's assessment reads **"nicht beurteilbar"** — *not assessable* — and nothing
is highlighted as a problem.

**"Not assessable" is not the same as "fine."** Until you type a number, the screen is showing
you the arithmetic and declining to grade it.

**What you must do:** open the *Gewinn & Verlust* screen and type your target margin — for
example `15` for 15%. Negative numbers are allowed and meaningful: `-5` means "I will accept up
to a 5% loss on this one", which is a real target for a building you are trying to win back.

### 6. The new worker features are not on anyone's iPhone

Your cleaners can now ask for materials from the app. That code is written and tested, but it is
not in the app on anyone's phone. The version on the phones is the older one.

**What you must do:** a new TestFlight build has to be produced and uploaded from Xcode. Until
then the iPhones behave exactly as they do today — which is also the reason none of this can
break clocking in and out in the meantime.

### 7. The Android app cannot go to the Play Store yet, because the signing key does not exist

See the Android section below. This one is genuinely yours and nobody else can do it.

---

## The four new screens

All four are in the left-hand menu now. They used to sit at the bottom under *"Kommt später"*
("coming later") with a padlock; that section is gone, because everything in it shipped.

### Materialanforderungen — what the cleaners have asked for

A cleaner standing in a building types, in their own words, what they need: *"zwei Mopps"*,
*"der blaue Reiniger, der große"*. It arrives here as a queue for you to work through.

You move each request one step at a time: **eingereicht → genehmigt → bestellt → eingetroffen**,
or you reject it. You cannot skip steps, and rejected and arrived are final.

Two things worth knowing:

- **Nothing is guessed.** The cleaner's words are never automatically matched to a product in
  your catalogue. *"The big blue cleaner"* is not a product code, and a guess would put a wrong
  price into your profit figures with no way to see where it came from. You link it to a product
  and type the real cost, or it stays as free text forever.
- **A note you write on a request is shown to the cleaner.** It is the only explanation a
  refused worker ever gets. If you want to write something for yourself, do not write it there.

There are **no push notifications** anywhere in this system, and the screens never promise one.
A cleaner finds out their mops arrived when they next open the app. That is a real limitation
and it is stated in the app rather than hidden.

### Gewinn & Verlust — money in against money out, per building

Covered in detail in the next section.

### Vertragsverwaltung — what each building is priced at, and since when

Until now a building had one price. If you raised it in September, every earlier month was
silently rewritten to the new price, and a report you printed in April no longer matched itself.

Now a price has a start date and an end date. **March keeps the March price.** Raising a price
today does not touch last spring.

I checked this on a real database: when a price was cleared, the old contract was **closed with
an end date, not deleted**, and the history before that date stayed intact and readable.

### Objektauswertung — hours worked against hours agreed, and where the buildings are

For each building: time actually worked, time the contract calls for, the difference, and a
short month-by-month history. Plus a map, when the two blockers above are cleared.

**Nothing exists only on the map.** The table below it lists every building, including the ones
with no coordinates, and it says so on screen. I tested this in a real browser with the key
removed, with a deliberately invalid key, and with the photographs failing to load. In all three
cases the page stayed usable, named the problem in German, and kept every building reachable.
There is no way to reach a state where a building quietly disappears because Google was unhappy.

---

## What the profit figures mean — and what they deliberately refuse to claim

For each building, over a period you choose:

> **Umsatz** (what the contract earns) **− Arbeit** (wages for hours worked) **− Material**
> (supplies) **= Gewinn**

Some care has gone into the parts that are easy to get quietly wrong.

### Every cent is accounted for

Materials are shared across buildings, so the total spend is split between them in proportion to
the hours worked at each (this was a deliberate earlier decision — the alternative, asking
cleaners to assign each bottle to a building, was rejected because nobody does it reliably).

Splitting money proportionally normally loses a cent or two to rounding, so the columns never
quite add up and you learn not to trust them. This does not. I tested it with twenty thousand
randomly generated awkward splits, including an amount chosen because it divides evenly by
nothing: **the parts added back to the total exactly, every single time**. Every figure is a
whole number of cents — there are no fractions of a cent anywhere.

### A laptop's clock cannot change a payslip

All dates are Vienna dates, worked out by the database using proper timezone rules, not a fixed
offset. That matters twice a year, and it matters at month end, which is payroll time.

I ran the whole calculation on machines set to five different timezones, from Kiribati to
Alaska. **The results were identical, character for character.** I also checked the two awkward
nights specifically: the March night that is 23 hours long, the October night that is 25 hours
long and where 02:30 happens twice. No hour was counted twice and none went missing, and twelve
monthly reports added up exactly to the yearly one.

### The four things it refuses to guess

Each of these shows as a blank with a written reason, never as a confident zero:

| Situation | What you see | Why not just show 0 |
|---|---|---|
| Building has no contract | *"Kein Vertrag hinterlegt"* | A building nobody has priced is unknown, not a 100% loss. It is also excluded from the totals rather than dragging them down. |
| A request nobody has priced | Counted and reported separately | Money was committed; nobody typed the invoice. That is not "free". |
| No target margin set | *"Nicht beurteilbar"* | The software does not get an opinion about your business. |
| Materials bought in a month nobody worked | Reported as unallocated | There are no hours to split them by. It is shown, not spread evenly and not dropped. |

### Two limitations stated permanently on the screen, not buried

**Unfinished shifts are left out of the cost — and it says so, per building.** When a cleaner
forgets to clock out, the system closes the shift after 8 hours as a guess. Until a human
confirms it, those hours are not paid and not counted as cost. That means a building can look
cheap purely because three shifts are stuck waiting for confirmation. So each row also shows how
many shifts were excluded and how many hours they hold. A building whose costs look too good is
told to you as such.

**Wages are valued at today's rate, including for the past.** There is only one wage figure per
cleaner, with no history. Give someone a raise and last March's labour cost changes. The screen
says this permanently — it is not a tooltip you have to find.

This is the one thing in the new work that is half-fixed: **income** is now period-correct,
**wages** are not. Fixing it means changing how payroll itself calculates, which is live money
for real people, so it was deliberately written up as a proposal for you to approve rather than
quietly changed. It is on file as decision 28.

---

## Android: the real status

**The app compiles, installs and runs.** I built it myself for this review rather than taking
anyone's word for it — debug build, release build and the Play Store package, all three
succeeded. The sign-in screen appears, in German, and the app correctly receives a tag address
handed to it by the operating system.

Before this round it had **never been compiled once**. That is genuinely fixed.

**What has still never happened:**

- **Nobody has tapped a real NFC tag with it.** No emulator has NFC hardware — that is physics,
  not a bug. Every step after the phone reads the tag is proven; the tap itself is not.
- **Nobody has signed in.** Doing so needs a real code issued to a real cleaner against the live
  server, which would put test data next to your real payroll. So the screens behind sign-in
  have been compiled but never actually looked at by a human.
- **Tapping a tag currently opens a web browser, not the app.** This is the missing signing key
  below, and it cannot be fixed before you create one.

There is one honest caveat: the release package I built is signed with a **debug** key, because
no real key exists. It is a working app, but it **cannot be uploaded to Google Play in that
state** — and I would rather it refuse loudly than produce something that looks uploadable.

---

## What you personally have to do for the Play Store

Nobody else can do the first item. Everything else waits on it.

### 1. Create the signing key — and never lose it

A signing key is a file plus a password that proves an app update came from you. Google will
tie your app to it permanently.

**If you lose it, you can never update the app again.** Not "it is difficult" — you would have
to publish a brand-new listing, and every cleaner would have to uninstall and reinstall. There
is no recovery, no support ticket, no exception.

- It must be **yours**, created by you and kept by you.
- Back it up in at least two places that are not the same laptop. Store the password with it
  but not in the same file.
- The exact command is written down in `android/README.md`, along with why each part matters.

### 2. Buy the Play Console account — €25, once

A **personal** account is the right choice and this is already decided and written up
(decision 27). You may have heard that Google requires 12 testers for 14 consecutive days
before you can publish — **that rule does not apply to you.** It applies to *production*
releases. This app goes on the **internal testing** track, which has no such requirement and
holds up to 100 testers. You have between 5 and 20 cleaners.

You do **not** need a D-U-N-S number. That is for organisation accounts.

One thing to know for later: if you ever sell this system to another cleaning company, their
staff are not your internal testers, and this decision has to be revisited — and account type
cannot simply be switched. If that is ever more than hypothetical, start the D-U-N-S paperwork
early. It is free and costs nothing to have and not need.

### 3. Three forms Google requires even for internal testing

- A **privacy policy** at a public web address.
- The **data safety** form. Answer it truthfully: this app collects worker identity and
  where they work.
- A **content rating** questionnaire.

### 4. After the key exists — hand over two fingerprints

Once the key exists and the app is uploaded, two short codes ("fingerprints") have to be added
to a file on the server. **Two, not one:** one from your key, one that Google generates. Until
both are there, tapping a tag on Android opens a web browser instead of the app.

The check script already warns about this and will keep warning until it is done:

> warn: android.sha256CertFingerprints is EMPTY — Android App Links are unverified and every
> Android tap opens the browser

Whoever does the deployment knows where these go; you only need to supply them.

---

## What I checked, so you know what this assurance is worth

- The iPhone app still compiles, and the parts that clock people in and out were **not touched
  at all** — the change is purely additions. All five of its self-checks pass.
- Database update 5 applied cleanly to a copy of your real live database, on the same database
  version the live server runs. The live database itself was **not touched**; it is still at
  update 4, exactly as before.
- All 127 server checks pass, and they still pass on machines set to four different timezones.
- The admin panel builds, and all fifteen pages including the four new ones were opened in a
  real browser against a real server with real data.
- German and English are complete and consistent with each other, every menu entry leads to a
  page that exists, and the "coming later" section is genuinely gone rather than just hidden.
- A secret scan found **nothing** committed to the project's history — no keys, no passwords, no
  signing material.

### Two things I fixed while checking

- **A building's map pin could be silently erased.** Saving a building after an unrelated edit
  could wipe its coordinates while still claiming it was on the map, and it would then have been
  skipped by both repair routines — permanently unpinned, while reporting itself as fine. Fixed,
  with a test that fails if anyone undoes it.
- **Two German phrases invented a second word for "shift"** where the rest of the panel says
  *Schicht*. Now consistent.

### What nobody can check from here

A real NFC tap on a real Android phone, and anything requiring a Play Console account or a
signing key. Those need you and a physical handset.
