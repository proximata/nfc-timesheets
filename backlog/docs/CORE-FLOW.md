# CORE FLOW — what actually works, and the phone script

Last reader before the owner. Written at `8c01fb6`, tree clean.
Everything below was re-run by this agent, not copied from the two reports it reconciles.
Where the reports disagreed with the machine, the machine won.

---

## 1. The verdict on the six things

`lab` = driven against a real Postgres / a fake card / a real apk, on this laptop.
`field` = will happen on the owner's phone against `schimmer-glanz.exe.xyz` today.

| # | What the owner needs | lab | field | why |
|---|---|---|---|---|
| 1 | self-update | ✓ | **✗** | `GET /app/version` → **404 on production** |
| 2 | writing a tag | ✓ | ⚠ | phone-local, works — but **no card has ever been written** |
| 3 | reporting the tag to the office | ✓ | **✗** | `POST /operator/tags` → **404 on production** |
| 4 | admin turning it into a building/zone | ✓ | **✗** | no routes, no `/tags/` page, **DB at migration 005** |
| 5 | a tap opening a shift | ✓ | ✓ | this is what runs in the field now |
| 6 | a tap on an unbound tag being harmless | ✓ | ✓ | 422, no shift, a German sentence — two ways |

**Two of six work in the field. Four are finished, checked, and not deployed.**

### The thing neither report said

Both reports drove the flow against a **local** server. Nobody looked at production.
Probed read-only, just now:

```
POST /operator/tags                     -> 404 not_found
POST /operator/enrol                    -> 404 not_found
POST /admin/tags/<id>/resolve-building  -> 404 not_found
GET  /app/version                       -> 404 not_found
GET  /tags/   (admin panel)             -> 404
GET  /operators/                        -> 404
ssh: /srv/nfc/routes/ = admin app auth portal wellknown     (no operator.js, no release.js)
ssh: db/migrations/   = 001..005        (no 006 zones, no 007 operators, no 008 reported_tags)
```

The API host is **three migrations and two route files behind this repo**. Steps 3, 4 and the
self-update cannot run in the field until someone deploys. That is not in scope here and was
not done.

Consequence for the stairwell, and it is the useful one: **a card written today can be written
and verified, but cannot be reported, and cannot be turned into a building.** It is a correct
card that nothing yet points at.

---

## 2. What was re-run here, and what it said

| check | result |
|---|---|
| `android/checks/run.sh` | OK — core, known-tags, **tag-writer** (bytes printed at the write call) |
| `android/checks/release-artefact.sh` | OK — 5 needles absent from release, `makeReadOnly` absent from both |
| ↳ **re-seeded RED by this agent** | a needle that IS in release → `FAILED`, exit 1 ✓ the check can fail |
| `server/check-api.js` | PASS, **182 assertions, 0 skips**, against a real Postgres |
| `server/check-close-flag.mjs` | 7 pass 0 fail |
| `demo/check-guards.sh` | OK |
| `web && pnpm verify` | OK, `/tags` in the route table |
| `NFCTimeSheets/checks/run.sh` | OK — incl. the `+` corpus report 1 fixed |
| `ops/check-branding.mjs` | OK (one pre-existing TODO: iOS still names the renameable host) |
| apk signer, 0.3.0-4 vs 0.4.0-5 | **identical cert** `6c786899…996c` ∴ installs over the field build, **no uninstall** |
| tag host `assetlinks.json` | publishes that same fingerprint ∴ a passive tap opens the app, not Chrome |

Report 1's central claim — that `release-artefact.sh` was inverted by `pipefail` + `grep -q` +
SIGPIPE, and that the release arm therefore could not fail — is **confirmed**. So is the fix.

---

## 3. Two findings this pass, neither in either report

### ✗ FIXED — `android/dist/` held a **stale apk under the same version number**

`dist/nfc-timesheets-0.4.0-5-release.apk` was built at 18:06, before the process-death fix
landed at 20:44. Same `versionName` 0.4.0, same `versionCode` 5, **different bytes**, missing
`pending_tag_report`. `dist/` is the obvious place to grab a build from, and self-update would
never offer an upgrade over it because the version code is equal.

Re-ran `./dist-apk.sh`. `dist/` and `app/build/outputs/apk/release/` are now the same sha256
`c4c46ffb…6b33`, and the fix is in it. (`dist/` is gitignored; nothing to commit.)

### ✓ FIXED at `9822f64` — the write screen **no longer overwrites a mounted card**

> Everything from here to the end of this section describes the defect as it stood at
> `3b78510`, and is kept because the phone script below was written around it. **The build
> to carry into the stairwell is now `dist/nfc-timesheets-0.4.1-6-release.apk`**, and on it:
>
> | card presented | 0.4.0 (5) | 0.4.1 (6) |
> |---|---|---|
> | blank NTAG213 | writes | writes |
> | one of ours, **same** id (retry after a bad verify) | writes | writes |
> | one of ours, **different** id — **a mounted card** | **writes, says success** | **REFUSED, untouched** |
> | foreign content (a shop's URL, a Text record, rubbish) | writes | writes, and says what it replaced |
> | card unreadable before the write | writes | nothing written — present it again |
>
> The override is not "are you sure": the screen prints the id on the card and the operator
> types its **last six characters** back. That authorises **that one card**; the next card
> is refused again. And the write itself now needs an operator session on the phone —
> without one, reader mode is never enabled and the screen does not read a card at all.
>
> **Which means step 3 below changed in the field:** on 0.4.1 the operator must enrol
> (`Betreiber-Code`) **before** a card can be written, and `POST /operator/enrol` is still
> 404 on production (§1). **Deploy first, or carry 0.4.0 for a write-only test.**

Driven off-device at `3b78510`, real `TagWriter`, fake card pre-loaded with the live HOIV tag:

```
card holds : c3c37d4a-…-9704b9907ec7   (the building in production)
screen offers: 11111111-…-555555555599  (a fresh, unknown id)
outcome    : Written(...)               <- SUCCESS, no warning
card now   : 11111111-…-555555555599
```

Nothing compares the card's existing content to anything. `Tag beschreiben` is on the
**Erfassen** screen, reachable by any user of the app, not just an operator — the operator
session only gates the *report*, never the *write*. One mis-tap next to a mounted tag turns a
working door into 422 for everybody, and the screen says **"Geschrieben und geprueft."**

Not fixed *in that pass* on purpose: it is the one class that changes a physical object, there
is no hardware to verify a change against, and the owner was about to test. Filed as TASK-220,
and fixed in the next pass the same way it was found — by driving the real `TagWriter` against
fake cards and reading the observed call log, eleven kinds of card, printed as a table
(`android/checks/run.sh`). Both halves of the fix were seeded back and shown RED before being
believed: deleting the guard turns nine assertions red, including this exact trace; deleting
the role gate turns two red in `core-check` § 16c.

---

## 4. THE PHONE SCRIPT

Real phone, real card. Read only this section in the stairwell.

### Before you leave the desk

1. Install the build. **Never uninstall first** — that wipes the worker's login.
   ```
   adb install -r android/dist/nfc-timesheets-0.4.0-5-release.apk
   ```
2. Open the app once. Android sends NFC to an app that has never been opened: **no.**
3. `Einstellungen` must read `Installiert: 0.4.0 (5)`. If it reads 0.3.0 (4), the install did
   not take — stop and redo it.
4. Carry: **two blank NTAG213**, and **one spare Mifare Ultralight** (the small foreign kind
   already on the wall at HOIV). The Ultralight is not a spare card — it is the test.
5. Screen **on and unlocked** for every step. Android does not deliver a tag otherwise.
   This is not a bug and there is nothing to report about it.

### Step 0 — the tap still works (do this first, it is the only thing in production)

Hold the phone to the **existing mounted HOIV tag**.

- ✓ the app opens and a shift starts. Tap it again → the shift closes.
- ✗ **Chrome opens instead of the app** → App Links did not verify on this phone.
  Not a card fault. The card is fine. Reinstall the app and open it once.
- ✗ nothing at all → NFC off, or screen locked. The app shows
  *"NFC ist ausgeschaltet"* if that is it.

### Step 1 — write a blank NTAG213

`Erfassen` → **`Tag beschreiben`**.

> **On 0.4.0 (5):** ⚠ from the moment that screen is open, keep every already-mounted card
> away from the phone. That build writes whatever card it sees, including a working one, and
> reports success. Press **`Fertig`** the instant you are done. Do not walk past a mounted
> tag with it open.
>
> **On 0.4.1 (6):** a mounted card is refused —
> *"NICHT beschrieben. Diese Karte traegt bereits die ID …"* — and nothing is written to it.
> That message is the guard working, not a fault. The card in your hand is unchanged.
> This screen also needs a `Betreiber-Code` before it reads any card at all.

Hold a **blank** NTAG213 to the phone. Keep it still.

| what you see | what it means | mount it? |
|---|---|---|
| **"Geschrieben und geprueft."** + ID + `64 von 137 Byte` | the card was written, read back, and matched byte for byte | **YES** |
| "Der Tag war zu kurz am Telefon…" | nothing was written | hold it steady, try again |
| "NICHT beschrieben…" (any wording) | the card was **not touched**, it is still blank | **NO** — use a different card |
| **"ACHTUNG: … Kontrolle beim Zurueklesen hat NICHT gestimmt"** | the card may hold half a message | **NO. STOP.** Re-present it once; if it still says this, **bin the card.** Never mount it. |
| *(0.4.1)* "NICHT beschrieben. Diese Karte traegt bereits die ID …" | that card is **already one of ours** — it came off a wall, or you wrote it earlier. Untouched. | **NO** — take a blank one. Only override it if you genuinely mean to retire that id. |
| *(0.4.1)* "Hinweis: Die Karte war nicht leer… (fremder Inhalt)" | it held somebody else's data, now overwritten. Nothing of ours was lost. | **YES** |

**Write the ID down on paper, next to where you are mounting it.** Today the office cannot be
told automatically (step 3), so paper is the only record.

### Step 1b — *(0.4.1 only)* the mounted card must be REFUSED

Same screen. Hold the card you just wrote in step 1 to the phone **a second time, after the
new id has been reported or written down** — i.e. once the screen is offering a fresh id.

- ✓ expected: **"NICHT beschrieben. Diese Karte traegt bereits die ID …"**, and the card is
  unchanged. Tap it as a worker afterwards: it still resolves to the id you wrote.
- ✗ **if it says "Geschrieben und geprueft" — the guard did not fire on real hardware.**
  Stop writing cards and report it. Off a phone this is proven only against a fake card.

*(Re-presenting a card while the screen is still offering the SAME id is the retry path and
does write — that is correct, and it is how a card that failed its read-back is repaired.)*

### Step 2 — the Ultralight must be REFUSED

Same screen. Hold the **foreign Mifare Ultralight** to the phone.

- ✓ expected: **"NICHT beschrieben. Dieser Tag fasst nur 46 Byte, gebraucht werden 64…"**
  The card was not touched. This is the check working.
- ✗ **if it says "Geschrieben und geprueft" on the Ultralight — STOP THE WHOLE TEST.**
  It means the capacity gate did not fire on real hardware, and every card written after
  it is suspect. Nothing off a phone can rule this out; that is why this step exists.

This is the single most important step in the script.

### Step 3 — the report to the office (expected to FAIL today)

Right after a successful write the screen tries to tell the office, by itself.

- **Today it will say: "Der Tag ist fertig, aber die Meldung an das Buero ist fehlgeschlagen
  (not_found)."** That is correct and expected — the server does not have this feature yet
  (§1). **The card is fine. Mount it.** The paper note is the record.
- "Der Tag ist fertig, aber dieses Telefon ist nicht als Betreiber angemeldet." — also fine,
  same conclusion. Do not type a code; there is nothing to enrol against yet.
- "An das Buero gemeldet. Der Tag kann jetzt montiert werden." — only possible after a deploy.
- If you kill the app and reopen `Tag beschreiben`, the last written card comes back with a
  **`Meldung erneut senden`** button and no words next to it. That button being there means
  **the office still does not know.** That is the whole point of it.

### Step 4 — tap the new card (expected to be REFUSED today)

Mount or just hold the card you wrote in step 1, and tap it as a worker.

- ✓ expected: the app opens and shows **"Vom Server abgelehnt. Diese Schicht bitte der
  Verwaltung melden."** — and **no shift is created.**
  That is the correct answer for a card the office has never claimed. Verified against
  production's own code path: `422 unknown_location`, and after a deploy the same tap gives
  `422 tag_unbound`. Either way: no shift, a German sentence, no crash.
- ✗ **if a shift opens on a card nobody has claimed — stop and report it.** That is the one
  outcome that must not happen.
- ✗ if the app crashes → report it, keep the card.

### Step 5 — self-update (expected to be UNAVAILABLE today)

`Einstellungen` → `Nach Updates suchen`.

- expected today: it fails and offers **`Erneut versuchen`**. Nothing is broken; the endpoint
  is not deployed. It never blocks anything and never touches a running shift.
- ✗ if it downloads and installs something → stop, that would mean it is talking to a server
  nobody deployed.

### The three sentences that mean STOP

1. **"Geschrieben und geprueft"** shown for the **Ultralight** → capacity gate failed on
   hardware. Bin every card written after it.
2. **"ACHTUNG: … Kontrolle beim Zurueklesen hat NICHT gestimmt"** → half-written card. Bin it.
3. **A shift opens on a card the office has never claimed** → the unbound guard failed.

Anything else on this list is a card you can mount or a feature that is simply not deployed.

---

## 5. What is still unproven, in one place

- **No NFC card has ever been written by this code.** Every write assertion is against a
  stubbed card in `android/checks/fake/`.
- Whether the platform's own NDEF encoder agrees byte-for-byte with `core/NdefTag`. It fails
  **closed** (`TagWriter` refuses rather than writes), so the risk is a card that will not
  write, not a card written wrongly.
- Whether a real NTAG213 reports `maxSize` **137** or the raw **180**. This is the one wrong
  number that would let an over-large message through — step 2 of the script is what settles it.
- Tag pulled mid-write, NFC toggled off mid-write, screen locked, app force-stopped mid-write.
- Android 9 vs 16. Only one phone has been used.
- Anything in production: **nothing was deployed and nothing on the VM was changed.**
- Decisions 41–44 are still PROPOSED (43 supersedes the accepted 37). Nothing here rules on
  them and nothing here changed today's behaviour.
