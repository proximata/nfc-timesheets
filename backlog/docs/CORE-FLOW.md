# CORE FLOW — what actually works, and the phone script

Rewritten at `65bb162`, after the whole product was driven against **production** rather
than a laptop. Everything below was re-run by the agent that wrote it. Where a report and
the machine disagreed, the machine won.

Reproduce the whole thing:

```
./ops/prove-live.sh                    # 75 assertions against schimmer-glanz.exe.xyz
./ops/check-prove-live-mutants.sh      # the same 14 assertions, shown RED first
```

**Read `backlog/docs/STATE-OF-THE-PRODUCT.md` first if you are about to show this to a
client.** It is the verdict pass of 2026-08-21: it re-ran, re-photographed and re-measured
this file, `LOOK.md`, `LOOK-PHONE.md` and `RELIABILITY.md` against the live box, separates
what is proven from what was merely never looked at, and answers VISUAL / UX / RELIABILITY
separately. Its first finding is the one that matters here: thirteen fixes were committed
and none of them deployed, so for five hours production served the bugs those commits had
already closed (TASK-231).

**This file says what WORKS. `backlog/docs/RELIABILITY.md` says what happens when it
breaks** — production stopped, restarted, rebooted, filled and raced on purpose on
2026-08-20, ranked by what each failure costs the cleaner or the director. Read it before
the client starts relying on this: five of the ten entries there are things nobody finds
out about at all.

`prove-live` creates an operator, two written cards, a building, a zone, a worker and three
shifts on the live box, drives them through the real HTTP surface, and deletes every one of
them — then counts what is left and fails if a single row survives.

---

## 1. The verdict on the six things

`lab` = a real Postgres, a fake card, a real apk, on this laptop.
`field` = **production**: `schimmer-glanz.exe.xyz`, its Postgres, its published APK.
`hand` = a human, a phone and a physical card. **Nothing has ever reached this column.**

| # | What the owner needs | lab | field | hand | evidence |
|---|---|---|---|---|---|
| 1 | self-update | ✓ | **✓** | ✗ | `/app/version` → 0.4.1 (6); bytes match the manifest sha; same signer as the field build |
| 2 | writing a tag | ✓ | n/a | **✗** | phone-local. No server can close this; step 1 of § 4 is what does |
| 3 | reporting the tag to the office | ✓ | **✓** | ✗ | `POST /operator/tags` → 201, lands UNBOUND; twice → 200, still one row |
| 4 | admin turning the card into a **zone** | ✓ | **✓** | ✗ | resolve-zone → 201 (resolve-building is DELETED, decision-47: it answers 404 on the live box); screenshot of the live `/tags/` panel |
| 4b | a zone going LIVE only after a test scan | ✓ | **✓** | ✗ | `POST /operator/zones/:id/verify` → 200 with the shift count unchanged; the unverified tap → 422 `zone_unverified`, no row (`ops/prove-zone-verification.sh`) |
| 5 | a tap opening a shift | ✓ | **✓** | ✗ | old-shape body; zone card → 201 carrying `start_zone_id`; second tap closes it |
| 6 | a tap on an unbound tag being harmless | ✓ | **✓** | ✗ | 422 `tag_unbound`, no shift row, its OWN German sentence |

**Five of six are now proven in the field.** The sixth is a card in a hand, and the field
column does not apply to it: no server, no check and no emulator can write an NTAG213.

### What the field run added that the lab run could not

The lab checks mint their tag ids with `randomUUID()`. That tests the server and nothing
about the product: a phone that wrote the wrong bytes, refused every card, or overwrote a
mounted one would leave every lab assertion green. `ops/prove-live.sh` starts at the card —
`android/checks/live-flow.sh` runs the real `nfc/TagWriter`, and **the ids it emits are the
ids that are then reported, resolved, tapped and closed on production**.

Three kinds of evidence at every step, because each alone lies:

```
row    psql on the box            what is true
log    journalctl -u nfc-api      that THIS process answered, not a cache or a proxy
screen the German the phone renders + a headless-Chrome shot of the live admin, logged in
```

An empty access-log match is a FAILURE, not a shrug. Mutant 11 pushes the log window past
every request the run makes and all eight `log:` lines go red.

---

## 2. What was re-run, and what it said

| check | result |
|---|---|
| `ops/prove-live.sh` | **OK — 75 assertions, 0 fail, against production** |
| `ops/check-prove-live-mutants.sh` | **OK — 14 assertions RED, restored, GREEN** |
| `ops/smoke-live.sh` | OK — 82 assertions |
| `android/checks/run.sh` | OK — core, known-tags, tag-writer |
| `android/checks/live-flow.sh` | OK — 77 assertions, against the LIVE building id |
| `android/checks/release-artefact.sh` | OK — the simulator is absent from the release dex |
| `server/check-api.js` | PASS — **182 assertions, 0 skips** |
| `server/check-close-flag.mjs` | 7 pass, 0 fail |
| `server/check-phone-namespace.mjs` | OK |
| `server/check-telemetry-wire.mjs` | PASS — needs `node --import ./instrument.mjs`, or it asserts out |
| `demo/check-guards.sh` | OK |
| `web && pnpm verify` | OK — `/tags` in the route table |
| `ops/check-branding.mjs` | OK |
| `ops/check-hoiv-survives-006.mjs` · `check-delete-worker` · `check-reset-w1` | OK |

### Three things the field run found that no lab run could

**a. The debug mock had drifted from the shipping build.** `src/debug/WriteSimulation.kt` is
what an operator taps in place of a card on an emulator. It compared the read-back as raw
bytes, so a card left holding half a message reported `mismatch` — where the phone reports
`FormatException`, because `Ndef.getNdefMessage()` parses before it returns. It also fed
`WriteGuard` only our strict decoder's opinion, making it *stricter* than the phone about
what counts as one of ours. Both fixed; `live-flow-check` § 2 now replays every scenario
through the real `TagWriter` and requires the same screen, word for word.

**b. The map WAS intermittent, and it WAS a config fault — CLOSED.** Two rounds of "the
referrer is authorised" turned out false, in both directions. `demo/check-map-key.mjs`
tests the browser key by ASKING GOOGLE, over a real hostname, rather than by reading a
console screenshot from memory — and that is what finally settled it:

```
gcloud services api-keys describe <browser key> --project=nfc-timesheets
  allowedReferrers BEFORE: https://timesheets.exe.xyz/*, http://localhost:3000/*,
                           http://127.0.0.1:8080/*        <- NOT schimmer-glanz.exe.xyz
```

`https://timesheets.exe.xyz/*` is the TAG host (decision-40) — it has served no admin
panel since the two-host split. The API host the admin panel actually runs on was never on
the allowlist at all, only the box's PRE-RENAME name. Every fresh load from
`https://schimmer-glanz.exe.xyz/` should therefore have failed every time — and mostly
didn't, because Google's edge network appears to cache a validated script response for a
referrer it has already approved once, and does not re-validate on every hit; only a
cache-miss edge enforces the (wrong) config. That is the mechanism behind "4 drew, 1
`RefererNotAllowedMapError`, same minute, same key, same referrer" — a real, config-caused
defect, made to LOOK like flake by a caching layer neither app owns.

FIXED 2026-08-21: `gcloud services api-keys update` added
`https://schimmer-glanz.exe.xyz/*` to the allowlist (kept everything already there,
including `http://127.0.0.1:8080/*` — every local map check in this repo runs against
it). `node demo/check-map-key.mjs` — OK on both `apiHost` and `tagHost`.
`ops/prove-live.sh` re-run against production with `MAP_SAMPLES=10`: **the map drew
10/10**, up from the 4/5 that was actually "sometimes hits the one edge that checks."
TASK-206 closed.

**c. The closing count caught a row this work itself left behind** — a throwaway admin from
a debugging session — and blamed the run for it. `admins` is now in the START guard too: a
start guard that does not cover a table the end guard covers only moves the failure to the
wrong place.

---

## 3. The guard, against the row the cleaners tap

TASK-220 was proven against a **hardcoded** uuid in a source file that *says* it is the
building in production. Nobody had asked production. `live-flow-check` refuses to run
without `LIVE_HOIV_ID` read off the live database, so this is now a claim about the card on
the wall:

```
live building        c3c37d4a-ca0a-42c5-b248-9704b9907ec7   (SELECTed off the box)
card presented       holds exactly that
screen offers        a fresh, unknown id
outcome              Refused.Occupied      token 907ec7 = the last six of the LIVE id
call log             Ndef.get -> connect -> getMaxSize -> isWritable -> getNdefMessage -> close
                     ^ no writeNdefMessage. The card was not touched.
```

- an empty box, six wrong characters, and **the last six of the id being OFFERED** (which is
  on the same screen, right above, and is the obvious wrong thing to copy) all confirm nothing
- the right six do — and confirming *this* card does not license the *next* one
- the override then writes, and the screen says the live id is gone and the office must
  re-assign that door

---

## 4. THE PHONE SCRIPT

Real phone, real cards. **Read only this section in the stairwell.** Everything else in this
file is already true; this is the part that is not.

### At the desk

1. **Install `android/dist/nfc-timesheets-0.4.1-6-release.apk`.**
   ```
   adb install -r android/dist/nfc-timesheets-0.4.1-6-release.apk
   ```
   **Never uninstall first** — that wipes the worker's login. `-r` works because 0.4.1 and
   the build already on the phone carry the same signing certificate (`6c786899…996c`).
2. Open the app once. Android does not deliver NFC to an app that has never been opened.
3. `Einstellungen` must read **`Installiert: 0.4.1 (6)`**. If it says 0.4.0 (5) or 0.3.0 (4),
   the install did not take. Stop and redo it.
4. **Get a `Betreiber-Code`**: admin panel → `Betreiber` → the operator → issue a code.
   Type it into `Tag beschreiben`. **Without a code that screen does not read a card at
   all** — reader mode is never enabled. This is the role gate, not a fault.
5. Carry: **two blank NTAG213**, and **the foreign Mifare Ultralight** (the small kind
   already on the wall at HOIV). The Ultralight is not a spare card. It is step 1.
6. Screen **on and unlocked** for every step. Android delivers no tag otherwise. Not a bug,
   nothing to report.

---

### Step 1 — THE ULTRALIGHT MUST BE REFUSED. Do this before anything is written.

`Erfassen` → `Tag beschreiben`. Hold the **foreign Mifare Ultralight** to the phone.

- ✓ **`NICHT beschrieben. Dieser Tag fasst nur 46 Byte, gebraucht werden 64…`**
  The card was not touched. Go on to step 2.
- ✗ **`Geschrieben und geprueft` on the Ultralight → STOP THE WHOLE TEST.**
  Write nothing else. Bin nothing yet, mount nothing, and report it.

**Why this is first, and why it is load-bearing.** The refusal comes from one number: what
`Ndef.getMaxSize()` reports. Every check in this repo feeds that number to a fake card, so
all of them assume the platform tells the truth. A real NTAG213 has 180 bytes of memory and
should report **137** as its NDEF capacity; if some phone or some card reports the raw
**180** instead, the gate opens for a message that does not fit, and a card gets written
half-way. The Ultralight is the only instrument that answers this, because it is the one
card in the building whose real capacity is below our message size. **If it writes, every
card written after it is suspect** — which is why nothing is written before it.

---

### Step 2 — write a blank NTAG213

Same screen. Hold a **blank** card. Keep it still.

| what you see | what it means | mount it? |
|---|---|---|
| **`Geschrieben und geprueft.`** + ID + `64 von 137 Byte` | written, read back, byte-identical | **YES** |
| `Der Tag war zu kurz am Telefon…` | nothing was written | hold it steadier, try again |
| `NICHT beschrieben…` (any wording) | **untouched**, still blank | **NO** — use another card |
| **`ACHTUNG: … Kontrolle beim Zurueklesen hat NICHT gestimmt`** | may hold half a message | **NO. STOP.** Re-present once; if it repeats, **bin the card** |
| `Hinweis: Die Karte war nicht leer… (fremder Inhalt)` | somebody else's data, now overwritten. Nothing of ours lost | **YES** |

**`64 von 137 Byte` is a result, not decoration.** If that first number is not 64, or the
second is not 137, write it down — it is the answer to the question step 1 asks.

---

### Step 3 — the same card must now be REFUSED

Hold the card you just wrote to the phone **again**, once the screen is offering a fresh id.

- ✓ **`NICHT beschrieben. Diese Karte traegt bereits die ID …`** and the card is unchanged.
  This is the guard working. That card came off a wall as far as the phone knows.
- ✗ **`Geschrieben und geprueft` → the guard did not fire on real hardware.** Stop writing
  cards and report it. Off a phone this is proven only against fake cards.

*(Re-presenting a card while the screen still offers the SAME id is the retry path and does
write — that is correct, and it is how a card that failed its read-back is repaired.)*

---

### Step 4 — the office is told, by itself

Right after a successful write the phone reports the card.

- ✓ **`An das Buero gemeldet. Der Tag kann jetzt montiert werden.`** — the office has it.
- `Der Tag ist fertig, aber dieses Telefon ist nicht als Betreiber angemeldet.` — the code
  from desk step 4 was not entered or has expired. **The card is fine.** Enter a code; the
  report is sent automatically.
- `…die Meldung an das Buero ist fehlgeschlagen (…)` — no signal. **The card is fine.**
  Tap `Meldung erneut senden` when there is signal, or write the ID on paper.
- Killing and reopening `Tag beschreiben` brings the last written card back with a
  `Meldung erneut senden` button and no words beside it. **That button being there means
  the office still does not know.** That is the whole point of it.

Reporting the same card twice is harmless: one row, every time.

---

### Step 5 — the office decides what the card IS

Admin panel → `Unzugeordnete Tags`. The card is in the table with the time and the operator
who reported it. Two choices, both keep the id already burned into the card:

- **`Neue Zone in bestehendem Gebäude`** — pick the building, name the zone.
- **`Bestehende Zone (zweiter Tag)`** — the card becomes a second tag on a zone that exists.

**A card can no longer become a NEW BUILDING** (decision-47). `POST /admin/tags/:id/resolve-building`
is deleted and answers 404. A building discovered on a field visit is created TAG-FREE under
„Objekte" — its id comes from the database, never from a card — and the reported card then
becomes that building's FIRST ZONE. The screen says so where the radio used to be.

Nothing is written to the card by any of this. Once resolved, the row leaves the list.

---

### Step 5b — an operator proves the card, in the building, before anyone can clock in

A zone lands **UNVERIFIED**. It is a real, active row and it is **not a clock-in target**: a
tap answers `422 zone_unverified` and **writes no shift**. What makes it live is an operator,
on site, with the card in hand:

```
GET  /operator/zones                 the worklist, unverified first, + the serial map
POST /operator/zones/:id/verify      { place_uuid }  -> 200, verified_at stamped
```

It resolves the card through `v.activePlace` — the same function `POST /shifts/open` calls —
and then requires the card to name the zone the operator picked, so a card mounted at the
wrong door is refused (`422 zone_mismatch`) rather than blessed. **It cannot open a shift:**
both routes are `auth: "operator"`, and no shift route accepts a `ts_operator` cookie. A
second scan is a harmless 200 that moves no timestamp.

The card already on the wall at HOIV carries a **building** uuid and is untouched by all of
this, for ever: verification is a zone-only concept and a building tap reads no zone at all.

---

### Step 6 — a cleaner taps it

Mount the card, or just hold it, and tap as a worker.

- ✓ the app opens and a shift starts. **Tap it again → the shift closes.** There is no
  button in the app that closes a shift, and there is not meant to be.
- ✗ **Chrome opens instead of the app** → App Links did not verify on this phone. Not a card
  fault. Reinstall the app and open it once.
- ✗ nothing at all → NFC off, or the screen locked. The app says `NFC ist ausgeschaltet` if
  that is it.

---

### Step 7 — a card the office has NOT claimed must open nothing

Tap the **second** card you wrote, before anybody resolves it in step 5.

- ✓ **`Dieser Tag ist noch keinem Objekt zugeordnet. Bitte bei der Verwaltung melden.`** and
  **no shift.** The server answered `422 tag_unbound`. This used to fall into the generic
  `err_rejected` bucket ("report this shift to your admin") — wrong, because there IS no
  shift, nothing was ever opened, and this is not a rare refusal: a card gets mounted at a
  door before the office resolves it in step 5, routinely. `err_tag_unbound` names what to
  do instead: this tag, not a shift.
- ✗ **a shift opens on a card nobody has claimed → stop and report it.** That is the one
  outcome that must not happen.

---

### The three sentences that mean STOP

1. **`Geschrieben und geprueft`** shown for the **Ultralight** (step 1) — capacity gate
   failed on hardware. Bin every card written after it.
2. **`ACHTUNG: … Kontrolle beim Zurueklesen hat NICHT gestimmt`** — half-written card. Bin it.
3. **A shift opens on a card the office has never claimed** (step 7) — the unbound guard
   failed.

Everything else on the list is a card you can mount, or a message that is telling you the
truth about the network.

---

## 5. What is still unproven, in one place

Everything here is a phone, a card, or an Android version. Nothing on this list can be
closed from a laptop, and production has nothing to say about any of it.

- **No NFC card has ever been written by this code.** Every write assertion is against a
  stubbed card in `android/checks/fake/`.
- Whether a real NTAG213 reports `maxSize` **137** or the raw **180**. Step 1 of § 4 settles
  it, and is the reason step 1 is step 1.
- Whether the platform's own NDEF encoder agrees byte-for-byte with `core/NdefTag`. It fails
  **closed** (`TagWriter` refuses rather than writes), so the risk is a card that will not
  write, not a card written wrongly.
- Whether the overwrite guard fires against a real mounted card (§ 4 step 3).
- Tag pulled mid-write, NFC toggled off mid-write, screen locked, app force-stopped mid-write.
- Android 9 vs 16. One phone has been used.
- Whether a warm, human browser would have seen the map flake in § 2b — moot now: § 2b's
  flake had a config cause (the referrer allowlist never named the API host), it is fixed,
  and `ops/prove-live.sh MAP_SAMPLES=10` against production reads 10/10 post-fix. TASK-206
  closed 2026-08-21.
- **Everything in `backlog/docs/RELIABILITY.md` § "What this run did NOT test"**: a real
  phone losing signal in a real basement, Postgres corrupting itself rather than merely
  running out of disk, and more than one worker tapping at once.

### And what is no longer unproven

- ~~Anything in production~~ — the whole chain now runs against it, writes rows and deletes
  them again (`ops/prove-live.sh`).
- ~~The guard is proven against a constant that claims to be the live building~~ — it is
  proven against the uuid read off the live database.
- ~~The debug mock stands in for hardware~~ — it does, and it is now held to the shipping
  writer's own verdict on every scenario.
- ~~Decisions 41–44 are PROPOSED~~ — ACCEPTED 2026-08-19; decision-37 superseded, with the
  four contradictions written into its own file. HOIV stays active, keeps its pin and still
  answers 201 after 006 — grey on the map, never gone (decision-43, re-asserted live in
  `prove-live` § 9).
