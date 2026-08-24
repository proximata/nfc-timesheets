# SMS-ONBOARDING — onboarding is an ACTION the admin takes, never a setting on a person

Decision record: `backlog/decisions/decision-48`. Relates to decision-8 (German first),
decision-16/23 (`pg` + `@sentry/node`, nothing else), decision-22 (identity from the
session, never the body), decision-26 (enrolment codes — **reused verbatim, never
replaced**), decision-24 (operator identity is configuration), decision-45 (`phone_identities`
is the ONE phone namespace).

**AMENDS the "replacing enrolment codes" clause** in `ops/workflows/ITERATIONS.md` ("Twilio
SMS login LAST, replacing enrolment codes") and in decision-45 §6 ("SMS (W5) replaces this
and the worker Android enrolment-code path together"). It replaces nothing. The owner's
sentence forbids it.

---

## 0 · One screen

> **"in admin there must be an option to choose how to onboard a worker, so if sms didnt
> work, there is always a fallback."** — the owner, verbatim

```
onboarding model     REPEATABLE ACTION, not a stored preference          -> §2
phone column         NONE ADDED. phone_identities.phone_e164 (007)        -> §3
the flag             smsConfigured()  derived, no SMS_ENABLED boolean     -> §4
flag off             503 sms_not_configured / disabled button + a SENTENCE-> §4.3
phase 1              admin clicks "SMS senden" -> the SAME decision-26 code -> §5
phase 2              worker types phone -> 6-digit OTP -> worker_sessions -> §6
fallback             the SMS route RETURNS THE CODE before it calls Twilio -> §7
android, this run    NOTHING. Zero Kotlin, zero strings, no versionCode   -> §6.6
migration            011_sms_onboarding.sql  (sms_deliveries only)        -> §5.2
new npm deps         ZERO. One fetch() POST, Basic auth, form-encoded.    -> §5.4
```

The single load-bearing sentence, and everything in §7 exists to make it structurally true
rather than merely asserted:

> **"SMS senden" is `POST /admin/workers/:id/enrolment-code` with a delivery attempt
> appended after the response body is already built, so the admin is holding a working
> code on screen before Twilio is ever contacted — including when Twilio is not
> configured, is down, or the number is wrong.**

---

## 1 · What is true today, measured this run — not remembered

```
prod DB, read-only, 2026-08-22        workers=0 operators=0 phone_identities=0
                                      locations=0 shifts=0 admins=1
schema_migrations, max                010_zone_verification.sql   -> next free is 011
/etc/nfc/env on the API host          APP_KEY  DATABASE_URL  GOOGLE_GEOCODING_KEY  PORT
                                      NO TWILIO_* AT ALL
psst tag "server"                     TWILIO_SID (prefix SK, len 34)  TWILIO_SECRET (len 32)
grep sms|Sms|SMS|otp|OTP              0 hits in server/lib server/routes web/app web/lib
                                        android/app/src  (2 unrelated prose hits)
```

Three facts follow and all three are load-bearing:

1. **`TWILIO_SID` is `SK`-prefixed** — an API Key SID, which is a valid Basic-Auth
   *username* but is **not** the Account SID that goes in the URL path. Twilio's endpoint
   is `/2010-04-01/Accounts/{AccountSid}/Messages.json` and there is no auth scheme that
   removes that path segment. **Nobody can send an SMS today, with any code we write.**
2. **No sender exists** — neither a `TWILIO_FROM` number nor a Messaging Service SID.
3. **The live box does not even carry the two secrets it has.** `/etc/nfc/env` is generated
   from the vault and today lists four keys, none of them Twilio. So the flag in §4 is OFF
   on production by *configuration that already exists*, not by a promise.

The existing enrolment-code path, which this work may not disturb:

```
admin  POST   /admin/workers/:id/enrolment-code   -> {code, display, expires_at}  shown ONCE
admin  DELETE /admin/workers/:id/enrolment-code   -> revoke, one click
phone  POST   /auth/code {code}                   -> ts_worker cookie, worker_sessions row
code   8 chars Crockford base32, 40 bits, 5 days, single use, SHA-256 at rest, revocable
limits per-IP 5 fails -> 30s doubling to 15 min  +  global 30 attempts/min (shared space)
panel  web/app/workers/page.tsx — codeStateOf() -> none|live|expired|redeemed, words first
```

---

## 2 · THE OPEN QUESTION, ANSWERED: a repeatable action

**Decision: onboarding method is an ACTION the admin takes at the moment of onboarding.
Two buttons, side by side, both live for every active worker, for ever. No column, no
preference, no default, no "primary channel", no wizard.**

### 2.1 Read the owner's sentence literally

> "…an **option to choose** how to onboard a worker, **so if sms didnt work**, there is
> **always** a fallback."

Three words decide it.

| word | what it forces |
| --- | --- |
| **choose** | the choice is made *by a person, at a moment* — a preference is chosen once and then *obeyed* |
| **if sms didnt work** | the fallback is needed **after** SMS has already been attempted and failed — i.e. in the same sitting, with the failure on screen |
| **always** | not "when configured", not "when the preference says so". `always` is a property of a screen, and a screen cannot promise `always` about a value stored in a column |

A stored preference (`workers.onboarding_method = 'sms' | 'code'`) fails the middle column
outright. At the exact moment SMS fails, the admin would have to leave the failure, open
the edit drawer, change a dropdown, save, and come back — an edit round-trip inserted into
a recovery path, at the one moment when a cleaner is standing at a door waiting. The
fallback would be *reachable*, which is not what the owner asked for; he asked for it to be
*there*.

### 2.2 The three arguments a preference usually wins on, and why it loses all three here

**"It records what we do for this person."** No, it records what we *intended*. A column
saying `sms` for a worker whose number turned out to be a landline is a field that is
confidently wrong and that nothing ever corrects. What actually answers "which channel did
we use for Ivan and did it arrive" is an append-only delivery log — `sms_deliveries` (§5.2)
— and once that log exists the preference column is a *worse copy of it*, disagreeing with
it the first time an admin clicks the other button.

**"It saves the admin a decision."** The choice is between two visible buttons on a row he
is already looking at. There is no decision to save. A preference would replace one click
with: a field on the create form, a field on the edit form, a migration, a default value
somebody has to justify, two more i18n keys per locale, and a new question nobody has an
answer to — *what does the screen do when the preference says `sms` and SMS is not
configured?* Every one of those is a way to be wrong that the two-button version cannot
reach.

**"It is more flexible later."** The opposite. A stored preference is a state that other
code starts branching on. The moment a batch action, a report or an Android screen reads
`onboarding_method`, hiding or disabling the code path becomes a one-line change somebody
makes in good faith — and the owner's `always` is gone. The repeatable-action model has no
value for such code to read.

### 2.3 It is also the SIMPLER option, which is why it is not being chosen "out of caution"

```
stored preference    migration + column + CHECK + create form + edit form + 4 i18n keys
                     + a default + a "preference vs. reality" branch on every render
repeatable action    0 columns. 0 migrations for this question. 1 button. 0 defaults.
```

### 2.4 It matches the idiom decision-26 already shipped

`enrolment_code_issued_at` / `issued_by` / `redeemed_at` are not a preference — they are the
state left behind by **the last action taken**, and issuing a new code resets the trio so it
always describes one code (migration 004's own words). SMS delivery is the same species of
fact and gets the same treatment: an append-only row per attempt, and nothing on the worker
that claims to know what will happen next time.

### 2.5 What the admin sees, concretely

Inside the **existing code cell** of `web/app/workers/page.tsx` — not a new column; that
table already carries seven and a 390px phone cannot take another (the cell's own comment
says so):

```
Zugangscode
  Gültig bis 27.08.2026, 14:32
  [ Zugangscode erzeugen ]  [ SMS senden ]  [ Sperren ]
  SMS an +43 664 123 45 67 übergeben (14:27).
```

and when SMS is not configured, with the word carrying it and the colour second:

```
  [ Zugangscode erzeugen ]  [ SMS senden (deaktiviert) ]
  SMS ist nicht eingerichtet. Code vorlesen oder kopieren.
```

Both buttons are always rendered. Neither is ever hidden. `Zugangscode erzeugen` is never
disabled by anything in this work (§7).

---

## 3 · The phone number: NO NEW COLUMN. `phone_identities` already is the answer

**Decision: SMS login reuses `phone_identities.phone_e164` (migration 007, decision-45).
`workers.phone` stays exactly what it is — free text, decorative, never normalised — and no
`workers.phone_e164` is created.**

### 3.1 `workers.phone` cannot be a login identity, and it is not close

`lib/validate.js` `optionalPhone()` (its own comment): *"Deliberately loose … rejects
letters and control characters … and nothing else. **Never normalised, because normalising
means silently changing what the director typed.**"*

So `workers.phone` can hold `0664/1234567`, `+43 664 1234567` and `0043 664 1234567` — three
spellings of one telephone, three distinct strings, no uniqueness, no `+`, no country. Every
one of the four things a login identity must do, it does not do:

```
canonical?   no — three spellings, three rows
unique?      no — no constraint of any kind
validated?   no — "()/.- and digits" is the entire grammar
dialable?    no — a bare national number has no country
```

Texting whatever is in that column would mean texting a string we never checked, and
matching an inbound OTP against it would mean matching on a spelling.

### 3.2 A new `workers.phone_e164 UNIQUE` would re-open the hole decision-45 closed

decision-45 exists because the owner said worker phones and operator phones *"live in ONE
namespace and may never collide, so the uniqueness has to be enforced by the database, not
by a screen."* A second E.164 column with its own UNIQUE constraint is, by construction, a
**second namespace**: `workers.phone_e164 = '+436641234567'` and
`phone_identities.phone_e164 = '+436641234567'` pointing at an operator would both be legal,
and the collision the owner made impossible becomes possible again — this time silently,
because both constraints are satisfied.

### 3.3 `phone_identities` was designed for exactly this, on the record

decision-45, Consequences: *"Forward-compatible with W5 (SMS) without a second migration:
`phone_identities` already holds the canonical number W5 needs to text."* It has the E.164
`CHECK`, the `PRIMARY KEY` that makes the collision atomic, `worker_id UNIQUE`,
`operator_id UNIQUE`, and an index for exactly one query — *which person owns this phone*.
That query is the first thing an inbound OTP does.

`lib/validate.js` `identityPhone()` already produces the canonical string, Austria-default,
and **refuses rather than guesses** a bare national number. It is reused verbatim. Nothing
about phone parsing is written for this feature.

### 3.4 The gap this opens, and the one route that closes it

`phone_identities` has **0 rows** and no route puts a WORKER in it: `POST /admin/workers`
writes free-text `phone` and claims nothing (`check-phone-namespace.mjs` §3 asserts exactly
this as a measured, named ceiling). `POST /operator/workers` is blocked by decision-45 §8's
unresolved rate conflict. So SMS to a worker is *unreachable* until a worker can acquire a
canonical number.

decision-45 already named the fix and did not build it: *"Promotion of existing rows is a
named, future, one-click admin action, not built here."* **This work builds it**, and it is
the only new write path:

```
PUT    /admin/workers/:id/phone  {phone}   -> 200 {phone_e164}
         v.identityPhone(body.phone)                     422 invalid_phone / required_field
         INSERT INTO phone_identities (phone_e164, worker_id) VALUES ($1,$2)
           ON CONFLICT (phone_e164) DO UPDATE SET worker_id = $2
             WHERE phone_identities.worker_id IS NULL       -- an operator may adopt a
                                                            -- worker half; never steal one
         23505 on worker_id / 0 rows      -> 409 phone_claimed   (names nobody — decision-45)
DELETE /admin/workers/:id/phone            -> 200, releases the claim
         UPDATE phone_identities SET worker_id = NULL WHERE worker_id = $1
         DELETE FROM phone_identities WHERE worker_id IS NULL AND operator_id IS NULL
```

The drawer **prefills** the field from the free-text `workers.phone` when one is on file,
shows the normalised `+43…` result before saving, and never writes it without the admin
pressing save. That is not a silent reformat — decision-45 §4 forbids reformatting the
free-text column, and this does not touch it. The two columns are, from that moment,
allowed to disagree, exactly as decision-45's Costs section already states.

Cell on the workers screen, second line of the phone cell:

```
Telefon      0664/123 45 67
Login-Nummer +436641234567          |  Login-Nummer nicht hinterlegt  [ Nummer hinterlegen ]
```

---

## 4 · The flag: `smsConfigured()`, derived from credentials, never a boolean somebody types

### 4.1 Name and shape

```js
// server/lib/sms.js
export function smsConfigured() { return smsMissing().length === 0 }
export function smsMissing()    { /* -> [] | ["account_sid","auth","sender"] */ }
```

**There is deliberately no `SMS_ENABLED` env var.** Two knobs are two ways to be wrong, and
a boolean typed by hand can contradict reality — `SMS_ENABLED=1` on a box with no Account
SID is exactly the "silently pretends" failure the owner forbade. Presence of a complete,
usable credential set **is** the flag, the same way `lib/geocode.js` treats
`GOOGLE_GEOCODING_KEY` (`no_key` → no pin, never an error). Turning SMS off is removing a
line from `/etc/nfc/env` and restarting — the same operation, one fewer thing to disagree.

| env var | required | shape checked at read time |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | **yes — MISSING TODAY** | `/^AC[0-9a-f]{32}$/i`; goes in the URL path |
| `TWILIO_SID` | yes, vaulted | Basic-auth username. `SK…` (API key) or `AC…` both valid |
| `TWILIO_SECRET` | yes, vaulted | Basic-auth password. Never logged, never echoed |
| `TWILIO_FROM` | one of these two — **BOTH MISSING TODAY** | E.164, `/^\+[1-9][0-9]{7,14}$/` |
| `TWILIO_MESSAGING_SERVICE_SID` | ″ | `/^MG[0-9a-f]{32}$/i`; wins if both are set |
| `TWILIO_API_BASE` | no | test seam only, defaults to `https://api.twilio.com`. §9 needs it |

A var that is present but **malformed** counts as missing. `TWILIO_ACCOUNT_SID=yes` must not
turn the feature on and then fail at the wire with a 404 from Twilio.

`TWILIO_API_BASE` is a seam and not a feature flag, and it is justified by §9's rule: without
it there is no way to make the negative cases fail without spending money or texting a real
handset — a check whose negative case cannot fail is not a check.

### 4.2 It is evaluated per request, not cached at boot

A boot-time constant means a corrected `/etc/nfc/env` needs a deploy to be believed, and it
means a check cannot flip the flag between two cases in one process. Reading four env vars
is a property lookup.

### 4.3 What happens when it is OFF — every layer, exhaustively

**Boot.** Nothing. No throw, no `process.exit`, no Sentry error (decision-23: telemetry may
never be required to boot). One line on stdout, once:

```
sms: not configured (missing: account_sid, sender)
```

Names **which** are missing. Never a value, never a prefix, never a length.

**`GET /admin/sms-status`** (admin auth) — `200 {"configured": false, "missing":
["account_sid","sender"], "sender_kind": null}`. Names only. This is what the panel fetches
alongside the worker list so the button's state is a fact from the server rather than a
guess in the bundle.

**`POST /admin/workers/:id/enrolment-code/sms`** — `503 {"error": "sms_not_configured"}`.

- **503, not 501, not 400, not 202.** The route exists and is correct; the *dependency* is
  unavailable. 503 is the one status that can never be read as "accepted".
- **Nothing is written.** No `sms_deliveries` row, no code minted, no `enrolment_code_*`
  column touched, no session, no counter spent. The worker's state is byte-identical
  before and after. (§9 check 1 asserts this, with a RED case.)
- The flag is checked **before** the rate limiters, so a misconfigured box can never lock a
  worker out of the code path by spending their budget on 503s.

**`POST /auth/sms/request` and `/auth/sms/verify`** (phase 2) — the same
`503 sms_not_configured`, same discipline. This *does* disclose "SMS is off here", and that
is deliberate: the owner's instruction is that it *"tells the admin plainly that SMS is not
configured"*, and a caller who cannot be told would sit and wait for a message that is never
coming. There is nothing to enumerate — it is a property of the server, not of a person.

**Admin UI.** The `SMS senden` button is **rendered, always**. It is `disabled` +
`aria-disabled="true"`, and the sentence sits next to it in words:

```
de: „SMS ist nicht eingerichtet. Code vorlesen oder kopieren."
en: "SMS is not set up. Read the code out or copy it."
```

It is never hidden. Hiding it would delete something true — that this system has an SMS
path and it is switched off — and would leave an admin who was told about the feature
looking for a control that is not there. `NOTHING TRUE may be deleted to lighten a screen`.
Colour is the second signal: the word comes first, the muted style second.

If the flag flips between page load and click (a deploy mid-session), the click gets 503 and
the screen renders **the same sentence**. The UI has exactly one way to say "sent", and it
is reached only by a response that says so.

**Android UI.** Nothing changes, because nothing is built (§6.6). The phone never sees the
flag, never renders an SMS control, and therefore cannot offer a door that answers 503.

---

## 5 · PHASE 1 — "SMS senden": the same code, a second delivery channel

This is what the owner's sentence is literally about: *how to onboard a worker*. It costs
zero Android work, zero new credential types and zero new failure modes on the phone.

### 5.1 The route

```
POST /admin/workers/:id/enrolment-code/sms       auth: "admin"
  200 { code, display, expires_at,
        delivery: { status: "sent",   provider_sid: "SM…", phone_e164: "+43…" } }
  200 { code, display, expires_at,
        delivery: { status: "failed", reason: "timeout" | "network" | "rejected",
                    provider_code: 21211 | null, phone_e164: "+43…" } }
  409 { error: "no_phone_identity" }     worker has no phone_identities row  -> §3.4
  503 { error: "sms_not_configured" }    NOTHING minted, NOTHING written     -> §4.3
  404 { error: "not_found" }             unknown or inactive worker (as the existing route)
```

**A failed send is a 200.** That is not sloppiness, it is the whole design: the code was
minted, it is in the body, it is on the admin's screen and it works. Making it a 4xx/5xx
would let the panel's error path swallow the code and destroy the fallback.

A **separate route**, not a `{deliver:"sms"}` flag on the existing one, so
`POST /admin/workers/:id/enrolment-code` keeps its current bytes and cannot regress. Both
call one extracted helper `mintEnrolmentCode(workerId, adminId)` so the two cannot drift.

Order inside the handler, and the order is the guarantee:

```
1  smsConfigured()            false -> 503, return. nothing has happened yet.
2  resolve phone_identities   none  -> 409, return. nothing has happened yet.
3  mintEnrolmentCode(...)     the SAME helper the existing button calls
4  build the 200 body         { code, display, expires_at }   <- the fallback now exists
5  await sendSms(...)         never throws; returns {status, reason?, provider_*?}
6  INSERT sms_deliveries      one row, always, whatever step 5 said
7  return body + delivery     the code is in it on every path through 5 and 6
```

### 5.2 Migration `011_sms_onboarding.sql` — one table, additive, no `BEGIN`/`COMMIT`

```sql
-- 011_sms_onboarding.sql — an append-only record of every SMS this system attempted.
-- decision-48. NO BEGIN/COMMIT: migrate.js runs each file with `psql -1`.
-- ADDITIVE ONLY. workers, operators, phone_identities: ZERO changes, no column added.
--
-- THIS IS THE TABLE THAT MAKES A "PREFERRED CHANNEL" COLUMN UNNECESSARY (decision-48 §2.2):
-- it records what HAPPENED, per attempt, instead of what somebody once intended.
--
-- WHAT IS NEVER IN HERE: the message body, the enrolment code, the OTP, any Twilio
-- credential. `provider_code` is Twilio's numeric error class (21211 invalid To, 21610
-- unsubscribed, …) and `provider_sid` is the SM… message id — both are references, not
-- content. lib/scrub.js already drops `^code$` from every event.
CREATE TABLE sms_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('enrolment_code', 'otp')),
  worker_id     BIGINT REFERENCES workers(id)   ON DELETE SET NULL,
  operator_id   BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  phone_e164    TEXT NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- TWO VALUES ONLY. There is no 'not_configured' and no 'queued': when the flag is off
  -- the route returns 503 before anything is minted, and a row here would be a delivery
  -- record for a non-delivery. 'sent' means TWILIO ACCEPTED IT, which is not 'arrived' —
  -- see §5.5 for why the panel says "übergeben" and never "zugestellt".
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  reason        TEXT,        -- failed only: timeout | network:<code> | rejected | http_<n>
  provider_sid  TEXT,        -- sent only
  provider_code INTEGER,     -- failed only, when Twilio named a code
  requested_by  BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sms_deliveries_worker_idx ON sms_deliveries (worker_id, created_at DESC)
  WHERE worker_id IS NOT NULL;
CREATE INDEX sms_deliveries_created_idx ON sms_deliveries (created_at DESC);
```

Append-only by convention: no route updates or deletes a row. `ON DELETE SET NULL` on both
person columns for the same reason migration 004 gives for `issued_by` — "sent to someone no
longer here" is still a fact.

### 5.3 The message, and why it is one segment

Rendered in German (decision-8), server-side — this string never goes through next-intl,
which is the web bundle's business:

```
{senderName}: Ihr Zugangscode lautet K7QF-3MZ2. Gültig bis 27.08. um 14:32 Uhr.
Bitte in der App eingeben.
```

- `senderName` comes from **`ops/branding.json`** (new optional key `smsSenderName`,
  defaulting to `appName` when absent) and never from a literal in `lib/sms.js` — decision-24:
  operator identity is configuration, not source. Shipping under another name must not
  require a code change.
- **GSM-7, ≤160 characters, one segment.** `ä ö ü ß Ä Ö Ü` are in the GSM 03.38 basic set and
  are fine. The German typographic quotes `„ "` are **not**, and a single one of them flips
  the whole message to UCS-2, which halves the limit to 70 and splits it into three
  segments — three times the money and three chances to arrive out of order. §9 check 4
  asserts this with a RED case, because it is exactly the kind of thing a well-meaning
  copy edit reintroduces.
- The expiry is rendered **in Vienna time** (`Europe/Vienna`), never UTC and never the
  server's locale, because "14:32" has to be the 14:32 the director would say on the phone —
  the same rule `dayTime()` follows in the panel. Vienna is UTC+1/+2; a code issued at 23:50
  CEST on the last Saturday of October expires on a day that has 25 hours, and the only way
  that is correct is by formatting an absolute `TIMESTAMPTZ` in the business zone.

### 5.4 The wire — one `fetch`, no SDK

```
POST {TWILIO_API_BASE}/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json
Authorization: Basic base64(TWILIO_SID + ":" + TWILIO_SECRET)
Content-Type:  application/x-www-form-urlencoded
Body: To=%2B43…&Body=…&(From=%2B43… | MessagingServiceSid=MG…)
AbortSignal.timeout(SMS_TIMEOUT_MS)          // 8_000, the leash lib/geocode.js already uses
```

`fetch` is Node stdlib. **Zero new npm dependencies** — server stays `pg` + `@sentry/node`
(decision-16 as amended by decision-23). The Twilio SDK would be ~40 transitive packages to
avoid writing eleven lines.

`sendSms()` **NEVER THROWS**, on the same rule and in the same shape as `lib/geocode.js`:
every failure ends in a `{status:"failed", reason}` object, and `reason` comes from a fixed
vocabulary (`timeout`, `network:<code>`, `rejected`, `http_<n>`) so no URL, no auth header,
no request body and no Twilio response body can ever reach a log, a Sentry event or a
client. `status: "sent"` is written **only** on a 2xx that carried an `SM…` sid.

### 5.5 "Übergeben", never "zugestellt"

Twilio's response at creation says `queued` or `accepted`. That is *"we have it"*, not
*"she has it"*. There are no delivery-status webhooks in this design (they would need a
public callback route, a signature check and a retry story). So the panel says:

```
de: „SMS an +43 664 123 45 67 übergeben (14:27)."
en: "SMS handed to the carrier for +43 664 123 45 67 (14:27)."
```

**Named ceiling.** We know it was accepted for delivery; we do not know it arrived. Upgrade
path: a `POST /sms/status` webhook with Twilio signature validation, updating a `delivered_at`
on `sms_deliveries` — its own decision, because it opens a new public route.

### 5.6 Rate limiting on the admin route

The caller is an authenticated admin, so there is no search space to protect — but there IS
money. `checkGlobalSmsRate()` (§6.4) is spent here too: **20 messages / rolling hour, 100 /
rolling 24h, process-wide.** Over the ceiling → `429 too_many_attempts` **before** step 3, so
nothing is minted and nothing is charged. A rolling millisecond window, never a calendar
day — a calendar day is 23 or 25 hours twice a year in Vienna and a spend cap must not
breathe with the clocks.

---

## 6 · PHASE 2 — the OTP login. Specified now, built after phase 1

> **⚠ AMENDED by decision-51.** §6.1 and §6.4 below are left exactly as written — this is a
> measured history of what was true when phase 2 was designed, and rewriting it in place
> would destroy that record. Two things below are no longer current:
>
> - **§6.1**: `POST /auth/sms/request` no longer answers a byte-identical `202` for every
>   number. A number that does not resolve to an ACTIVE worker now answers
>   `404 {"error":"unknown_phone"}`. The owner explicitly waived number-enumeration as a
>   threat for this deployment; see decision-51 for the full argument and its named costs.
> - **§6.4**: the **per-phone** limiter (`3/rolling hour, 10/rolling 24h`, bucketed on the
>   normalised number and spent for unknown numbers too) is DELETED — its only stated
>   purpose was making an unknown number behave like a known one, and decision-51 removes
>   that requirement outright. It is replaced by ONE **per-source-address** limiter, N per
>   rolling 5 minutes, N read from `app_settings` key `sms_otp_requests_per_5min`
>   (default 3, clamped 1..20, admin-tunable via the existing `POST /admin/settings` with no
>   restart). The other three rows of §6.4's table — per challenge, per IP on verify, and
>   global spend — are unchanged and not reordered.
>
> Everything else in §6, including the 200 body shape, the six-digit OTP, the 10-minute TTL
> and `POST /auth/sms/verify`'s single byte-identical `401 invalid_code`, stands as written.

Phase 1 is delivery of an existing credential. This is a *different mechanism with a
different threat model*, and conflating the two is how one of them gets sized wrong.

### 6.1 The flow

```
app    POST /auth/sms/request  {phone}          auth:"app"
         -> 202 {status:"accepted"}   IDENTICAL for a known and an unknown number
         -> 422 {error:"invalid_phone"}  shape only — not existence
         -> 429 {error:"too_many_attempts"}  +retry-after
         -> 503 {error:"sms_not_configured"}
app    POST /auth/sms/verify   {phone, code}    auth:"app"
         -> 200 {worker:{id,name}, expires_at}  + Set-Cookie: ts_worker
         -> 401 {error:"invalid_code"}   EVERY other outcome, byte for byte
         -> 429 / 503 as above
```

The 200 body and the cookie are **byte-identical to `POST /auth/code`'s**, because it is the
same `createWorkerSession(workerId)` call, the same `worker_sessions` row, the same
`ts_worker` cookie, the same 90-day TTL. Nothing downstream can tell which door was used,
and `worker_id` still comes from the session and never from a body (decision-22). One
session system, now **three** enrolment mechanisms — never three identity systems.

`202` and not `200 {sent:true}`: we are accepting a request, not asserting a delivery. The
body says nothing about whether a message was sent, so it cannot be a lie for an unknown
number and cannot be an enumeration oracle.

### 6.2 Six digits, and why NOT the enrolment code's alphabet

They are different objects and the difference is the channel:

| | enrolment code (decision-26) | SMS OTP |
| --- | --- | --- |
| how it travels | **any channel, including spoken aloud** | one SMS, one handset |
| optimised for | being *heard* and repeated | being *copied* off a notification |
| alphabet | Crockford base32, no I/L/O/U, aliased on input | digits |
| length / entropy | 8 chars, 40 bits | 6 digits, ~20 bits |
| life | 5 days | 10 minutes |
| search space | **SHARED** — every live code is a valid answer | **bound to one phone** |
| recipient | whoever the admin tells | the holder of that SIM |

Digits, because the OTP is never spoken: `inputType="numberPassword"` gives a numeric
keypad, Android's SMS Retriever / autofill heuristics key on short numeric codes, there is no
alphabet to explain to a tired cleaner, and there is no I/1 or O/0 ambiguity to alias away.
Crockford base32 solves a problem this credential does not have, and its 8 characters would
break autofill and the numeric keypad to solve it.

**Six is safe here and forty bits was needed there, for one structural reason:** an
enrolment-code guess is checked against *every live code in the system*, so an attacker's
odds scale with how many are outstanding. An OTP guess is checked against **the one
challenge minted for the phone number in the same request**. There is no union to attack.

```
keyspace                                     10^6 = 1_000_000
attempts per challenge                       5, then the challenge is BURNED
p(hit | one challenge)                       5 / 10^6           = 5.0e-6
requests per phone                           3 / rolling hour, 10 / rolling 24h
guesses per phone per day (max)              10 * 5 = 50 against 10 distinct secrets
p(hit | one phone, one day, saturated)       50 / 10^6          = 5.0e-5
expected days to a first hit, saturated      ~20_000 days  (~55 years)
```

and every one of those days the victim's handset rings with ten texts they did not ask for,
so the attack is **loud** as well as slow. Compare decision-26's code, which can be attacked
silently for five days.

If the length, the expiry, the attempt cap or either limit changes, **redo this block.**

### 6.3 Ten minutes, not five and not an hour

Five is the textbook number and it is wrong for this user: a cleaner is in a stairwell or a
basement, carrier delivery in Austria is usually seconds but is not always, and an OTP that
expires while it is in flight produces a second SMS and a second charge — the exact failure
that made decision-26 raise its own TTL from 60 minutes to 5 days after a real incident. An
hour is wrong the other way: the code sits readable on a lock screen on a table. Ten minutes
covers carrier latency plus typing. The arithmetic in §6.2 is bounded by **attempts**, not by
time, so the TTL does not move it.

### 6.4 Rate limiting — four separate limiters, each for a different reason

| limiter | budget | what it stops |
| --- | --- | --- |
| per challenge, in the DB | 5 wrong answers → burned | walking one live code |
| per phone, on **request** | 3 / rolling hour, 10 / rolling 24h | SMS-bombing one person; buying more secrets |
| per IP, on **verify** | `checkLoginRate("smsotp:" + ip)` — 5 fails, 30s doubling to 15 min | a flood from one source |
| **global spend**, both routes | 20 / rolling hour, 100 / rolling 24h | the bill, and IP rotation |

Two properties that are easy to get wrong and are therefore stated:

**The per-phone bucket counts requests for UNKNOWN numbers too.** If it only counted real
workers, a number that starts returning 429 after three tries would be an enumeration
oracle — it would confirm the number is on file. Bucketing on the normalised string
regardless of resolution makes the limiter's behaviour identical for both, so the 429 tells
an attacker only what they already knew: that they asked three times.

**Own buckets, never the enrolment ones.** `smsotp:` and not `enrol:`, exactly as
`/auth/operator-code` uses `enrolop:` — a stranger guessing OTPs must not lock a worker out
of typing an enrolment code from the same office address. And `checkGlobalSmsRate()` is a
**new** counter, not `checkGlobalEnrolmentRate()`: that one is sized against a shared
40-bit search space; this one is sized against a telephone bill. Different quantities, and
sharing them would silently re-tune the enrolment arithmetic in `lib/enrolment.js`.

### 6.5 `012_sms_otp.sql` — written when phase 2 is built, not before

```sql
CREATE TABLE otp_challenges (
  id           BIGSERIAL PRIMARY KEY,
  phone_e164   TEXT NOT NULL REFERENCES phone_identities(phone_e164) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,          -- SHA-256 via lib/auth.js hashToken, as everywhere
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_idx   ON otp_challenges (phone_e164, created_at DESC);
CREATE INDEX otp_challenges_expires_idx ON otp_challenges (expires_at);
```

Redemption is **one statement**, decided by the database, exactly as `/auth/code` does it:
`UPDATE … SET consumed_at = now() WHERE id = $1 AND code_hash = $2 AND expires_at > now()
AND consumed_at IS NULL AND attempts < 5 RETURNING …` — so two racing verifications cannot
both mint a session. Constant-time comparison against `DECOY_STORED` / `DECOY_PRESENTED`
from `lib/enrolment.js` on every path, hit or miss, so a missing challenge costs what a real
one costs.

**A migration with no writer is dead weight**, so this file does not exist until the phase-2
route does. `011` (§5.2) carries phase 1 alone. Both are additive; neither alters an existing
column.

**Scope ceiling, stated:** phase 2 is **worker-only**. A `phone_identities` row that carries
only `operator_id` gets the same `202` and no message, and operators keep their enrolment
code (`/auth/operator-code`). Extending it is a follow-up decision, not an implementation
detail.

### 6.6 Android scope for THIS run

**Android ships nothing this run: the enrolment-code sign-in screen, `EnrolmentCode.kt`,
`Api.kt` and the version code are untouched, because a phone that offers "Send me an SMS"
against a server that answers 503 is precisely the silent pretence the owner forbade — the
`/auth/sms/*` pair is specified server-side so the app can adopt it in a later run with no
server change.**

---

## 7 · How the enrolment code stays reachable NO MATTER WHAT

The sentence, and it is structural rather than a promise:

> **`POST /admin/workers/:id/enrolment-code`, `DELETE /admin/workers/:id/enrolment-code`,
> `POST /auth/code`, `codeStateOf()` and the code cell's `Zugangscode erzeugen` button are
> NOT MODIFIED by this work, and the new SMS route is a strict superset that calls the same
> mint helper and has its `{code, display, expires_at}` body fully built BEFORE Twilio is
> contacted — so there is no reachable state, including "not configured", "Twilio is down",
> "wrong number" and "rate limited", in which the admin is not already holding a working
> code on screen.**

Four independent things have to hold, and each has a check with a RED case in §9:

1. **Not modified.** The two admin routes and `/auth/code` keep their current bytes. Adding
   an option to an existing route would put the fallback behind a parameter; a new route
   cannot.
2. **Built before the send.** Step 4 of §5.1 precedes step 5. A code that exists in the
   response body cannot be lost by a network failure that happens afterwards.
3. **Never conditional in the UI.** `Zugangscode erzeugen` is rendered for every active
   worker with no reference to `smsConfigured`, `sms_deliveries` or a phone identity in its
   condition. Check 2 greps the render condition and fails if any of those three names
   appears in it.
4. **A failed send is a 200.** So the panel's error path cannot swallow the body.

And the negative case: the day someone deletes the code path anyway, `check-fallback-reachable.mjs`
goes red in `ops/prove-live.sh` before the deploy, not after.

---

## 8 · i18n — de/en exact key parity, Austrian business German

New keys under `workers` in `web/messages/{de,en}.json`. `web/scripts/check.mjs` §2 already
enforces identical key sets, identical ICU arguments, non-empty values, and `one` **and**
`other` branches on every plural — these are written to satisfy it.

| key | de | en |
| --- | --- | --- |
| `smsSend` | `SMS senden` | `Send SMS` |
| `smsSending` | `SMS wird gesendet …` | `Sending SMS …` |
| `smsNotConfigured` | `SMS ist nicht eingerichtet. Code vorlesen oder kopieren.` | `SMS is not set up. Read the code out or copy it.` |
| `smsHandedOver` | `SMS an {phone} übergeben ({time}).` | `SMS handed to the carrier for {phone} ({time}).` |
| `smsFailed` | `SMS nicht gesendet ({reason}). Der Zugangscode unten gilt trotzdem.` | `SMS not sent ({reason}). The code below is valid anyway.` |
| `smsNoPhone` | `Keine Login-Nummer hinterlegt.` | `No login number on file.` |
| `smsHistory` | `{count, plural, =0 {noch keine SMS verschickt} one {1 SMS verschickt} other {# SMS verschickt}}` | `{count, plural, =0 {no SMS sent yet} one {1 SMS sent} other {# SMS sent}}` |
| `phoneIdentity` | `Login-Nummer` | `Login number` |
| `phoneIdentityNone` | `nicht hinterlegt` | `not on file` |
| `phoneIdentitySave` | `Nummer hinterlegen` | `Save number` |
| `errorPhoneClaimed` | `Diese Nummer ist bereits einer anderen Person zugeordnet.` | `This number already belongs to someone else.` |

The German is the register the panel already uses — `hinterlegt`, `zugeordnet`, `Zugangscode`,
`SMS senden` (the owner's own words for the button). `übergeben`, never `zugestellt` (§5.5).
`verschickt` in the tally, not `gesendet`, because it reads as a count of completed
despatches rather than an ongoing action.

---

## 9 · The checks. Every one has a seeded RED case, and the RED must be RUN

**A check whose negative case cannot fail is not a check.** Each of these is run RED first —
condition seeded, check fails — then GREEN. `TWILIO_API_BASE` (§4.1) exists so the RED cases
cost no money and text no real handset.

| # | check | GREEN asserts | seeded RED that MUST fail |
| --- | --- | --- | --- |
| 1 | `server/check-sms-flag.mjs` | env cleared → `503 sms_not_configured`; `sms_deliveries` count unchanged; `workers.enrolment_code_hash` unchanged before/after | point `TWILIO_API_BASE` at a local stub and set all four vars → the same call must now 200 and mint. If the 503 case cannot be flipped, the flag is not being read |
| 2 | `ops/check-fallback-reachable.mjs` | both enrolment-code routes present in the route table; `/auth/code` present; the `Zugangscode erzeugen` render condition mentions none of `smsConfigured`/`sms_deliveries`/`phone_identit` | patched copy of `page.tsx` with the button wrapped in `{smsConfigured && …}`, and a patched `admin.js` with the DELETE route removed → both must fail the check |
| 3 | `server/check-sms-never-pretends.mjs` | stub returns 500, and separately never responds → `sms_deliveries.status='failed'` with a vocabulary `reason`; HTTP 200 still carries `code`; `delivery.status === "failed"` | mutant that writes `'sent'` on a non-2xx, and a mutant that omits `code` from the failed body → both must fail |
| 4 | `server/check-sms-message.mjs` | rendered message is GSM-7 and ≤160 chars for the longest plausible `smsSenderName`; expiry formatted in `Europe/Vienna`; a DST-boundary timestamp renders the Vienna wall clock | insert `„` into the template → must fail on GSM-7. Format the expiry in UTC → must fail the Vienna assertion |
| 5 | `server/check-phone-namespace.mjs` (**extended**) | after `PUT /admin/workers/:id/phone`, a second worker AND an operator are both refused that number; no second E.164 namespace exists — no column matching `%e164%` outside `phone_identities` | add `workers.phone_e164` in the scratch DB → must fail. Try to claim a number an operator holds → must 409 |
| 6 | `server/check-api.js` (**extended**) | the SMS route never appears on any `auth:"worker"`/`"operator"` path; a worker session cannot reach `/admin/workers/:id/enrolment-code/sms` | call it with a worker cookie → must 401, not 503 |
| 7 | `web/scripts/check.mjs` (existing) | de/en key parity, ICU argument parity, plural `one`+`other` | drop one `en` key → must fail (this check already proves its own RED) |
| 8 | `server/check-telemetry-wire.mjs` (**extended**) | no `To`, `Body`, `code`, `Authorization` or `TWILIO_*` value reaches a Sentry event or a log line | log the request body once → must fail |

Nothing in this feature is on the clock-in path, and check 6 is what keeps it that way:
`POST /shifts/open` reads no env var added here, no table added here, and no route added
here. **CLOCK-IN IS NEVER BLOCKED BY ANYTHING.**

---

## 10 · Deployment order

```
1  migration 011                          additive; no existing column altered
2  server: lib/sms.js + the 4 admin routes  flag reads FALSE on the live box (§1) ->
                                            every SMS route answers 503 from the moment
                                            it exists. Deployable with no credentials.
3  web: the buttons + the flag fetch        ships in the "not set up" state, which is the
                                            state it will actually be in
4  checks 1-8 RED then GREEN                before the deploy, in ops/prove-live.sh
5  credentials, later, by the owner         TWILIO_ACCOUNT_SID + a sender into the vault
                                            and the env sync -> the feature turns itself on
                                            with no code change and no deploy beyond a
                                            systemctl restart
6  phase 2 (OTP + Android)                  its own run, its own migration 012
```

Steps 1–4 are shippable **today**, with the feature permanently off, and that is the point:
the day the owner produces an `AC…` SID and a sender, nothing is written, reviewed or
deployed — a line goes into `/etc/nfc/env`.

---

## 11 · What this deliberately does NOT do

- **No delivery receipts.** `sent` means Twilio accepted it (§5.5). A webhook needs a public
  route and a signature check — its own decision.
- **No inbound SMS**, no STOP/START handling beyond whatever Twilio does for us. An
  unsubscribed number returns error 21610 and lands in `sms_deliveries` as `failed`.
- **No SMS for operators** in either phase (§6.5). They keep `/auth/operator-code`.
- **No SMS for admins.** decision-45 §5: the one login that must never break stays
  username+password (decision-20).
- **No `libphonenumber-js`.** `identityPhone()`'s Austria-default ceiling is inherited
  unchanged; a non-Austrian number typed without a `+` is refused, not misparsed.
- **No preference column, ever** (§2). If a future run wants "which channel do we usually
  use for Ivan", the answer is a `SELECT` on `sms_deliveries`, not a new column.
- **No iOS.** `NFCTimeSheets/` and `project.pbxproj` are not touched by any part of this.
- **No change to the enrolment code itself** — not its alphabet, not its length, not its
  5-day TTL, not its limiters. §6.2's table is a comparison, not a redesign.

---

## 12 · What did NOT happen

- **No SMS has been sent, by anyone, ever.** Not in a check, not in a test, not to a real
  handset. It is not possible: `TWILIO_ACCOUNT_SID` and a sender do not exist (§1).
- **No code was written in this run.** This document and the decision record are the
  deliverable; §5–§9 are a specification, not a description of something that runs.
- **`ops/branding.json` is unchanged.** `smsSenderName` (§5.3) is *proposed* here and is
  added by the implementing run, which must re-run `node ops/check-branding.mjs`.
- **The Twilio credentials were not read.** Their prefix and length were checked
  (`SK`, 34 / 32) to establish §1's finding; no value was printed, copied or committed.
- **Nothing was deployed.** Production is untouched by this run beyond three read-only
  `SELECT count(*)` statements and one `awk` over `/etc/nfc/env`'s key names.

---

## 13 · What the IMPLEMENTING run then built — 2026-08-22, deployed

§12 above is true **of the design run**. This section is the implementing run, and it exists
so the document does not go on claiming nothing was written.

```
migrations       011_sms_onboarding.sql (sms_deliveries)   APPLIED on the live box
                 012_sms_otp.sql        (otp_challenges)   APPLIED on the live box
                 -- 012 exists NOW because its writer exists now (§6.5's own rule)
server           lib/sms.js  +  4 admin routes  +  2 auth routes  +  one boot line
web              NOTHING. No file under web/ was touched.
android          NOTHING (§6.6). No Kotlin, no string, no versionCode.
ios              NOTHING. NFCTimeSheets/ and project.pbxproj untouched.
npm deps         unchanged: pg + @sentry/node. `fetch` is stdlib.
```

**The flag is OFF on production, measured after the deploy, not promised:**

```
journalctl -u nfc-api      sms: not configured (missing: account_sid, auth, sender)
GET  /admin/sms-status     200 {"configured":false,
                                "missing":["account_sid","auth","sender"],
                                "sender_kind":null}
POST /auth/sms/request     503 {"error":"sms_not_configured"}
POST /auth/sms/verify      503 {"error":"sms_not_configured"}
POST /admin/workers/101/enrolment-code/sms
       …with NO login number   503 {"error":"sms_not_configured"}
       …WITH a login number    503 {"error":"sms_not_configured"}   <- the 503 is the FLAG,
                                                                      not a missing number
sms_deliveries after all of that      0 rows
otp_challenges after all of that      0 rows
```

`auth` joins `account_sid` and `sender` in the missing list because `/etc/nfc/env` does not
carry even the two secrets the vault holds (§1 measured that already). `sender_name` is
**absent** from the list, which is the check that `ops/branding.json` resolved through the
two-candidate path `lib/sms.js` needs because `server/` is flattened to `/srv/nfc/` on the box.

**And the fallback, on the live box, in the same minute:**

```
POST /admin/workers/101/enrolment-code   201  {"code":"CH7Z-VPN3","expires_at":…}
POST /auth/code {"code":"CH7Z-VPN3"}     200  + Set-Cookie: ts_worker=…; 90 days
```

Every row this proof created was deleted afterwards; production is back to 0 workers,
0 phone_identities, 0 worker_sessions, 0 sms_deliveries, 0 otp_challenges, 1 admin.

### 13.1 · Two things the design got wrong, found by running it

**`SET worker_id = NULL` cannot release a claim.** `phone_identities_claims` (007) makes a row
that claims nobody UNREPRESENTABLE, so §3.4's `UPDATE phone_identities SET worker_id = NULL`
answers `500 … violates check constraint`. The release is a **DELETE** for a worker-only row
and a NULL only where an operator still holds the other half. decision-45's "named cleanup of
a both-NULL row" turns out to be unnecessary: the database refuses to create the litter.

**The promotion has to refuse BEFORE it releases.** `phone_identities.worker_id` is UNIQUE, so
the worker's previous claim must go before the new one is inserted — and releasing first would
mean a *refused* claim left the worker with no number at all. Order: check, release, claim.

### 13.2 · The checks, and the negative case for every one

```
server/check-sms-flag.mjs        the flag off (production's real env) -> 503, 0 rows, 0 calls;
                                 then ON against a local stub -> 200 + a real wire assertion
                                 (Account SID in the PATH, Basic SK pair, form-encoded)
server/check-sms-message.mjs     GSM-7, one segment, Europe/Vienna incl. the October boundary
ops/check-fallback-reachable.mjs the owner's „always": routes present, body built BEFORE the
                                 send, the code button conditional on `worker.active` ALONE
server/check-phone-namespace.mjs §3b: the promotion refuses from both sides, in both spellings

server/check-sms-mutants.sh                  11 mutants, ALL RED
ops/check-fallback-reachable-mutants.sh       9 mutants, ALL RED
server/check-phone-namespace-mutants.sh       8 mutants, ALL RED  (2 of them new)
```

`ops/check-fallback-reachable.mjs` and `check-sms-message.mjs` now run in **`ops/deploy.sh`
step 0**, before anything moves, so hiding the code button stops a deploy rather than being
noticed later.

**One named ceiling, measured rather than assumed.** The `consumed_at IS NULL` predicate
*inside* the redemption UPDATE could not be killed as a mutant on its own: with it removed and
**eight simultaneous** verifications fired at one live code, the result was still 1×200 / 7×401
and one `worker_sessions` row, because node lands the winner's UPDATE before the losers' SELECT.
It is genuine defence in depth against a race this harness cannot provoke from outside the
process. The honest mutant is therefore one semantic change across both sites.

Two mutants that had gone blind were also fixed: `check-phone-namespace-mutants.sh`'s
"the 409 leaks which kind of person" was anchored on a bare `fail(409, "phone_claimed")`, and
since this work there are TWO such sites — `perl -0777 s///` without `/g` was patching the
wrong route and reporting ALIVE.

### 13.3 · Still not done, and not pretended otherwise

> **Superseded within the same day by §14.** The first two bullets below were true when the
> server half landed and are NOT true any more: the panel and the Android screen both shipped
> a few hours later, in the same iteration. They are left standing rather than edited because
> a document that quietly rewrites what it said is a document nobody can date. §14 is the
> state of the box.

- **The panel.** No `SMS senden` button, no `Login-Nummer` cell, no i18n key. §8's table is
  still a proposal. The server contract it needs is in the run store under `server`.
- **Android.** Nothing, deliberately (§6.6).
- **`ops/branding.json` is still unchanged.** `smsSenderName` is read if present and falls back
  to `appName`; adding it is a one-line configuration change with no code change and no deploy.
- **Credentials.** `TWILIO_ACCOUNT_SID` and a sender still do not exist. The day they are put
  in the vault and synced, the feature turns itself on with a `systemctl restart` and nothing
  else — the flag is re-read per request, never cached at boot.

---

## 14 · FINAL STATE, re-derived against the live box — 2026-08-23

Written by the verification pass, which trusted none of §13 and measured the box instead.
Everything in this section was observed on `schimmer-glanz.exe.xyz` after a full
`ops/deploy.sh`, and every row it created was deleted again.

### 14.1 · What is live

```
box serves HEAD, file for file        ops/check-box-serves-head.sh   OK
  admin bundle                        eee7b85d… local == box
  browser JS/CSS                      b165726d… local == box
  server.js, instrument.mjs, lib/, routes/, wellknown/
  published APK                       nfc-timesheets-0.5.5-12-release.apk (versionCode 12)
schema_migrations                     012_sms_otp.sql is the top row; 011 below it
/etc/nfc/env                          APP_KEY, DATABASE_URL, GOOGLE_GEOCODING_KEY, PORT
                                      -- and NO TWILIO_* of any kind
```

The deploy that put it there ran every gate in `ops/deploy.sh`, including step 0's
`check-fallback-reachable` + `check-sms-message`, the migration dry run, `check-unit-drift`,
both `wellknown/verify.sh` runs (API host and TAG host) and `publish-apk --verify`.

### 14.2 · The two live proofs, both with the negative case SEEDED first

**`ops/prove-sms-live.sh`** — the server, end to end, on production.

```
1  the flag is OFF, in words, at every layer
     journalctl              sms: not configured (missing: account_sid, auth, sender)
     GET  /admin/sms-status  200 {"configured":false,"missing":[…],"sender_kind":null}
     GET  /auth/capabilities 200 {"sms":false}
2  a REAL worker, and the code that must never regress
     POST /admin/workers                       201
     POST …/enrolment-code                     201  FNHJ-8Z84
     POST …/enrolment-code/sms                 503  sms_not_configured
       -> the live code was NOT re-minted (the 503 precedes the mint)
       -> NO sms_deliveries row for a delivery that never happened
     POST /auth/code {FNHJ-8Z84}               200 + Set-Cookie ts_worker … 90 days
       *** the code still works AFTER the SMS attempt failed ***
     POST /auth/code {FNHJ-8Z84} again         401   (single use, unchanged)
3  the 503 is the FLAG, not a missing number
     PUT  …/phone                              200 +436609900148
     POST …/enrolment-code/sms                 503  -- with a number on file
4  POST /auth/sms/request                      503;  /auth/sms/verify 503;  otp_challenges 0
5  THE NEGATIVE CASE, SEEDED ON THIS BOX
     /etc/nfc/env gets a complete, correctly SHAPED, entirely FAKE credential set whose
     TWILIO_API_BASE is http://127.0.0.1:9099 -- a port with nothing on it, so the only
     possible outcome of a send is ECONNREFUSED and no message can leave the machine.
     RED  /auth/capabilities now {"sms":true}          -- §1 would FAIL
     RED  …/enrolment-code/sms now 200, not 503        -- §2 would FAIL
     RED  /auth/sms/request now 202                    -- §4 would FAIL
     ok   the 200 CARRIES A WORKING CODE, delivery.status="failed",
          reason network:ECONNREFUSED, and that code redeems at /auth/code -> 200
     ok   sms_deliveries row reads  failed|network:ECONNREFUSED|-  -- one vocabulary word,
          no recipient, no body, no credential, and never 'sent'
6  env restored and compared: sha256 ce6030bc…, identical; the 503s came back
```

**`ops/prove-sms-panel-live.mjs`** — the screen the director actually opens, driven with a
real headless Chrome against the live host and a database-minted admin cookie.

```
1+2  „SMS senden" is RENDERED for the active worker, disabled + aria-disabled, and the
     reason stands beside it IN WORDS: „SMS ist nicht eingerichtet. Code vorlesen oder
     kopieren."  „Zugangscode erstellen" sits in the SAME cell, ENABLED, one click away.
3    THE SABOTAGE SELF-TEST. The live DOM is mutated into the exact regression this
     document warns about — `disabled` stripped, the reason paragraph deleted — and the
     SAME oracle is re-run:
       RED  „SMS senden" is not disabled while SMS is off
       RED  aria-disabled is null, not "true"
       RED  the reason sentence is not beside the button
     Reload -> GREEN again. The oracle can fail, so its green means something.
4    the button is PRESSED: the standing code panel opens with 01AR-JWT6, and that code
     redeems at POST /auth/code -> 200. The fallback is a credential, not a rendering.
5    390px: both buttons, the sentence, and no horizontal overflow.
```

Screenshots stay on disk (`/tmp/ts-prove/sms-panel-live/`) — `docs/media` is gitignored
wholesale and nothing here is committed.

### 14.3 · decision-47 did not regress — and how that was established

`ops/prove-zone-verification.sh` **failed on its first run**, and the honest reading is that
its FIXTURE was gone, not that zone verification broke: production was wiped to zero
locations, and every section of that script hangs off the one real HOIV building whose uuid
is written on a card in Arsenalstrasse. §2's first `INSERT INTO zones` died on the foreign
key and nothing after it ran.

Two defects were found and fixed while establishing that, both of which had been hiding the
truth rather than causing it:

- **The cleanup report was going to `/dev/null` on exactly the path that needs it.** Measured
  in bash 3.2: when `set -e` fires inside `box "…" >/dev/null`, the EXIT trap runs with that
  redirection still in effect, so the cleanup header, the row counts and the verdict are all
  discarded. The run printed a psql error and nothing else — the rows really were deleted,
  and the proof that they were was thrown away. Fixed by saving the real stdout as fd 3
  before anything can redirect it. `ops/prove-sms-live.sh` had inherited the same idiom and
  was fixed with it.
- **It could not run against a wiped database at all.** It now refuses BY DEFAULT with a
  named reason, because on a box that is supposed to have the wall card, "the wall card is
  missing" is the most important thing this script could ever say and a script that silently
  repairs it would delete the finding. `PROVE47_SEED_WALL=1` is the deliberate way past it:
  it creates the building, runs, and removes it again.

With the fixture seeded, **every assertion passed**:

```
1  POST /admin/tags/:id/resolve-building        404 at the ROUTER — still retired
2  an UNVERIFIED zone: tap 422 zone_unverified, NO shift row
   *** THE CARD ON THE WALL STILL CLOCKS A WORKER IN (201) ***  start_zone_id NULL
   a clock-OUT through the unverified door closes normally — never gated
3  the operator worklist; a BUILDING card cannot verify a zone (422 zone_mismatch) and
   stamps nothing; the real card verifies (200); *** A TEST SCAN CREATED NO SHIFT ***;
   a re-scan is idempotent and verified_at does not move
4  the same tap that was refused: 201, billed to the BUILDING, door recorded as a fact
PROVE-47 OK
```

### 14.4 · Production, left exactly where it started

```
locations 0   zones 0   clients 0   contacts 0   workers 0   shifts 0
operators 0   phone_identities 0   sms_deliveries 0   otp_challenges 0
worker_sessions 0   operator_sessions 0   inventory_items 0   material_requests 0
location_revenue 0   location_contracts 0   reported_tags 0   tag_aliases 0
portal_grants 0   app_settings 0
admins 1  (id 2, "schimmer")          schema_migrations 12
sessions 2  -- both PRE-EXISTING browser sessions, created 19 and 21 August, untouched
```

Every admin session this pass minted (20 minutes each, straight into `sessions`, never a
guessed password) was deleted by hash. `/etc/nfc/env` is byte-identical to how it was found.

### 14.5 · What the owner must supply for a single SMS to ever be sent

Nothing in this repository is waiting on code. Two values are missing and both are
credentials:

1. **`TWILIO_ACCOUNT_SID`** — the `AC…` one, 32 hex. It is a **URL PATH SEGMENT** under every
   Twilio auth scheme, so the `SK…` API Key SID already in the vault cannot stand in for it.
2. **A sender, exactly one** — `TWILIO_FROM` (a real number in E.164, e.g. `+43720…`) **or**
   `TWILIO_MESSAGING_SERVICE_SID` (`MG…`, which wins if both are set).

And one operational step that is not a credential: **the two secrets already in the vault
(`TWILIO_SID`, `TWILIO_SECRET`) are not on the box.** `/etc/nfc/env` carries four keys and
none of them is Twilio.

**There is no sync script, and the env file's own header says there is.** `/etc/nfc/env`
begins `# GENERATED by ops/sync-secrets.sh from the psst vault (tag: server). Do not
hand-edit`, and `ops/sync-secrets.sh` **does not exist** — not in this repository and not in
`/srv/nfc/ops/` on the box. Whatever wrote that header was never committed. So today the file
IS hand-maintained, and following its own instruction not to hand-edit it leaves you with
nowhere to put the credentials. Vault them anyway (the vault is where the next person will
look), then append them:

```
psst set TWILIO_ACCOUNT_SID <AC…>     --tag server
psst set TWILIO_FROM        <+43…>    --tag server   # or TWILIO_MESSAGING_SERVICE_SID <MG…>
psst set TWILIO_SID / TWILIO_SECRET   already vaulted, just not on the box

ssh schimmer-glanz.exe.xyz
sudo tee -a /etc/nfc/env >/dev/null <<'EOF'
TWILIO_ACCOUNT_SID=AC…
TWILIO_SID=SK…
TWILIO_SECRET=…
TWILIO_FROM=+43…
EOF
sudo chown root:app /etc/nfc/env && sudo chmod 0640 /etc/nfc/env
sudo systemctl restart nfc-api
```

No deploy, no code change, no version gate: the flag is derived from the credentials and
re-read **per request**, so the next call after the restart is the one that works.
`sh ops/prove-sms-live.sh` re-run afterwards is what says so — its §5 will then be exercising
the real client against a real Account SID rather than a seeded fake, and §1's `503`
assertions will correctly go RED, which is the point at which somebody must decide whether
those assertions become "configured" assertions instead.

(A committed `ops/sync-secrets.sh` that renders `/etc/nfc/env` from the vault is worth
having and is NOT in scope here — filed rather than half-built.)

### 14.6 · What is STILL not observed, stated as a negative so it cannot read as a positive

- **No real SMS has ever been sent by this system, and none could be.** Every send in every
  check went to loopback or to a stub. Twilio has never been contacted. The first real
  message will be the first time this code meets a carrier.
- **`sent` would still mean Twilio ACCEPTED it, not that she read it.** There are no delivery
  receipts (that needs a public webhook with signature validation — its own decision), which
  is why `sms_deliveries` has no `delivered_at` column and the panel says „übergeben".
- **The Android SMS sign-in screen has not been seen on a phone.** versionCode 12 is built,
  signed and published to the self-update surface, but no `adb install` and no on-device
  render happened. Its capability guard is proven only by the JVM text-read check and by
  `GET /auth/capabilities` answering `{"sms":false}` live.
- **`PUT /admin/workers/:id/phone` has no UI.** It is proven over HTTP, live, but the panel
  has no `Login-Nummer` editor — so even with credentials in place, an admin cannot give a
  worker a login number without curl. That is TASK-244's remainder.
- **The rate limiters were exercised locally, never on production.** Deliberately: hammering
  a live limiter to watch it trip spends the same budget a real admin would need.
