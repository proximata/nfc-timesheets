---
id: decision-48
title: >-
  Onboarding is an action the admin takes, not a setting on a worker; SMS is a
  second delivery channel for the SAME enrolment code and never replaces it
date: '2026-08-22 21:10'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full design — every route, every column, every check with its seeded RED case:
`backlog/docs/SMS-ONBOARDING.md`.

Relates to decision-8 (German first), decision-16 + decision-23 (`pg` + `@sentry/node`,
nothing else), decision-20 (the admin's own login, untouched), decision-22 (identity comes
from the session, never the body), decision-24 (operator identity is configuration, not
source), decision-26 (enrolment codes — **reused verbatim, and explicitly preserved**),
decision-45 (`phone_identities` is the ONE phone namespace).

## ⚠ AMENDS the "SMS replaces enrolment codes" clause. It replaces NOTHING.

Two records currently say SMS will retire the code path:

| said today | amended to |
| --- | --- |
| `ops/workflows/ITERATIONS.md`, W5: "Twilio SMS login LAST, **replacing enrolment codes**" | SMS is **added alongside**. The enrolment code is not retired, deprecated, hidden, or put behind a preference — now or in any later phase |
| decision-45 §6: "SMS (W5) **replaces this and the worker Android enrolment-code path together**, in one later change" | the operator's `/auth/operator-code` and the worker's `/auth/code` both stay. §6's mirror-of-decision-26 reasoning is otherwise untouched |

The owner's sentence is what forces the amendment: a mechanism that has been replaced
cannot be a fallback for the thing that replaced it.

## Context

The owner, verbatim:

> "in admin there must be an option to choose how to onboard a worker, so if sms didnt
> work, there is always a fallback."

**Measured this run, not remembered:**

- Android's only way into a session is decision-26's admin-issued enrolment code
  (`POST /admin/workers/:id/enrolment-code` → `POST /auth/code`). It works and is live.
- **SMS/OTP does not exist anywhere.** Zero hits for `sms|Sms|SMS|otp|OTP` across
  `server/lib`, `server/routes`, `web/app`, `web/lib`, `android/app/src`.
- The Twilio credentials are **incomplete and unusable**. The psst `server` tag holds
  `TWILIO_SID` (prefix `SK`, 34 chars — an API **Key** SID) and `TWILIO_SECRET`. The
  Account SID (`AC…`) is missing, and it is a **URL path segment** under every Twilio auth
  scheme, so there is no way to send with what is vaulted. No sender exists either —
  neither `TWILIO_FROM` nor a Messaging Service SID.
- `/etc/nfc/env` on the live API host carries `APP_KEY`, `DATABASE_URL`,
  `GOOGLE_GEOCODING_KEY`, `PORT` — **no `TWILIO_*` at all**, not even the two that are
  vaulted.
- Production is at `010_zone_verification.sql` with 0 workers, 0 operators,
  0 `phone_identities`, 0 locations, 0 shifts, 1 admin.

So: nobody can send a real SMS today, and the question the owner left open — *is the
onboarding method a setting, or a thing you do?* — has to be answered before any of it is
built.

## Decision

### 1 · Onboarding method is a REPEATABLE ACTION, not a stored preference on the worker

Two buttons in the same cell, at the same weight — `SMS senden` and `Zugangscode erzeugen`
— both present for every active worker, both usable any number of times, in any order, for
ever. **No `workers.onboarding_method` column, no default, no primary channel, no wizard.**

Three words in the owner's sentence decide it:

- **"choose"** — the choice is made by a person at a moment. A preference is chosen once and
  thereafter *obeyed*.
- **"if sms didnt work"** — the fallback is needed **after** SMS has already failed, in the
  same sitting, with the failure on screen. A preference would insert an edit-drawer
  round-trip (open, change a dropdown, save, return) into a recovery path, at the one moment
  a cleaner is standing at a door. That makes the fallback *reachable*; the owner asked for
  it to be *there*.
- **"always"** — a property of a screen, not a value in a column. A column can say `sms` for
  a worker whose number turns out to be a landline, and nothing ever corrects it.

Rejected: `workers.onboarding_method`. It is also the **more complex** option — migration,
column, `CHECK`, create form, edit form, four i18n keys, a default somebody must justify,
and a new unanswerable question (*what does the screen do when the preference says `sms` and
SMS is not configured?*). And it does not even buy the audit trail it appears to: a
preference records **intent**, while `sms_deliveries` (below) records **what happened**, per
attempt. Once that log exists the column is a worse copy of it that starts disagreeing the
first time an admin clicks the other button.

This is also the idiom decision-26 already shipped: `enrolment_code_issued_at/by/redeemed_at`
is the state left by *the last action taken*, never a preference.

### 2 · SMS login gets NO new phone column. It reuses `phone_identities.phone_e164`

`workers.phone` stays free text, decorative, never normalised — `lib/validate.js`
`optionalPhone()`'s stated contract, re-affirmed by decision-45 §4. It has no canonical
form, no uniqueness, no country, and therefore cannot be a login identity: `0664/1234567`
and `+43 664 1234567` are one telephone and two strings.

A new `workers.phone_e164 UNIQUE` is rejected outright: it would be a **second E.164
namespace**, and a worker row and an operator's `phone_identities` row could then both hold
`+436641234567` with every constraint satisfied — re-opening precisely the collision
decision-45 made impossible with a `PRIMARY KEY`.

`phone_identities` (migration 007) already has the E.164 `CHECK`, the atomic uniqueness, and
an index for the one query an inbound SMS needs. decision-45's own Consequences section
predicted this: *"Forward-compatible with W5 (SMS) without a second migration:
`phone_identities` already holds the canonical number W5 needs to text."*
`v.identityPhone()` is reused verbatim; no phone parsing is written for this feature.

The gap that follows is real and is closed by exactly one new write path — the
"one-click promotion" decision-45 named and did not build:
`PUT /admin/workers/:id/phone` (409 `phone_claimed`, naming nobody) and
`DELETE /admin/workers/:id/phone`. The drawer prefills from `workers.phone` and shows the
normalised `+43…` before saving; it never rewrites the free-text column.

### 3 · The flag is DERIVED from the credentials — `smsConfigured()`, and there is no `SMS_ENABLED`

True only when **all** of `TWILIO_ACCOUNT_SID` (`AC…`), `TWILIO_SID`, `TWILIO_SECRET`, and
exactly one sender (`TWILIO_FROM` E.164 or `TWILIO_MESSAGING_SERVICE_SID` `MG…`) are present
**and well-shaped**. Malformed counts as missing. Evaluated per request, not cached at boot.

No hand-typed boolean, deliberately: `SMS_ENABLED=1` on a box with no Account SID is exactly
the silent pretence the owner forbade. Same shape as `lib/geocode.js`'s `no_key` — the
credential's presence *is* the switch.

**Fails closed at every layer, and says so plainly:**

| layer | flag OFF |
| --- | --- |
| boot | nothing fails. One stdout line: `sms: not configured (missing: account_sid, sender)` — **names**, never values |
| `GET /admin/sms-status` | `{configured:false, missing:["account_sid","sender"]}` |
| `POST /admin/workers/:id/enrolment-code/sms` | `503 sms_not_configured`, checked **before** the rate limiters, **before** minting. No `sms_deliveries` row, no code, no column touched, no budget spent |
| `POST /auth/sms/{request,verify}` | the same `503 sms_not_configured` |
| admin UI | the `SMS senden` button is **rendered, always**, `disabled` + `aria-disabled`, with the sentence in words beside it: „SMS ist nicht eingerichtet. Code vorlesen oder kopieren." Never hidden — nothing true is deleted to lighten a screen — and colour is the second signal |
| Android UI | nothing, because nothing is built (§6) |

`503` and never `202`: the route is correct, the *dependency* is unavailable, and 503 is the
one status that cannot be read as "accepted". **No new npm dependency**: one `fetch` POST,
Basic auth, form-encoded. `sendSms()` never throws — every failure becomes
`{status:"failed", reason}` from a fixed vocabulary, so no URL, credential or provider body
can reach a log, a Sentry event or a client.

### 4 · Two mechanisms, sized separately, both landing in `worker_sessions`

**Phase 1 — SMS delivery of the SAME decision-26 code.** `POST /admin/workers/:id/enrolment-code/sms`
mints through the same extracted helper the existing button calls, then attempts one send.
A failed send is a **200** carrying the code. `011_sms_onboarding.sql` adds one append-only
table, `sms_deliveries` (`kind`, `phone_e164`, `status` ∈ {`sent`,`failed`}, `reason`,
`provider_sid`, `provider_code`, `requested_by`) — never a message body, never a code. The
panel says „übergeben", never „zugestellt": Twilio's `queued`/`accepted` is not delivery, and
there are no receipts in this design.

**Phase 2 — a worker-initiated OTP login.** `POST /auth/sms/request` → `202` **identical for
a known and an unknown number** → `POST /auth/sms/verify` → `createWorkerSession()`: the
same `worker_sessions` row, the same `ts_worker` cookie, the same 90-day TTL, a body
byte-identical to `/auth/code`'s. One session system, three enrolment mechanisms — never
three identity systems, and `worker_id` still comes from the session (decision-22).

**Six digits, not the enrolment alphabet, because the channel is different.** An enrolment
code travels **any** channel including being spoken aloud, so it is Crockford base32 (no
I/L/O/U, aliased on input), 8 chars, 40 bits, 5 days — and its search space is **shared**:
every live code in the system is a valid answer. An OTP is machine-delivered to **one**
handset and is copied off a notification, never heard: digits give a numeric keypad and SMS
autofill, and the guess is checked against **the single challenge minted for that phone**.
No union to attack is the structural reason 20 bits is safe where 40 was needed.

```
keyspace 10^6 · 5 attempts then burned · 3 req/rolling hour, 10/rolling 24h per phone
p(hit | one phone, one saturated day) = 50/10^6 = 5e-5  ->  ~55 years, and LOUD:
the victim's handset rings ten times a day throughout.
```

TTL 10 minutes (5 is too short for a stairwell; an hour leaves it readable on a lock screen).
Four limiters, each for its own reason: per challenge (DB), per phone on request — **counting
unknown numbers too**, so the limiter is not an enumeration oracle — per IP on verify
(`smsotp:` bucket, never `enrol:`), and a **new** global spend cap (20/rolling hour,
100/rolling 24h) that is NOT `checkGlobalEnrolmentRate()`, because that one is sized against
a 40-bit shared search space and this one is sized against a telephone bill. Every window is
a rolling duration, never a calendar day — a Vienna calendar day is 23 or 25 hours twice a
year and a spend cap must not breathe with the clocks.

### 5 · The enrolment code is structurally unremovable by this work

> **`POST /admin/workers/:id/enrolment-code`, `DELETE /admin/workers/:id/enrolment-code`,
> `POST /auth/code`, `codeStateOf()` and the `Zugangscode erzeugen` button are NOT MODIFIED
> by this work, and the new SMS route is a strict superset that calls the same mint helper
> and has its `{code, display, expires_at}` body fully built BEFORE Twilio is contacted — so
> there is no reachable state, including "not configured", "Twilio is down", "wrong number"
> and "rate limited", in which the admin is not already holding a working code on screen.**

A **new route** rather than a `{deliver:"sms"}` option on the existing one, precisely so the
fallback can never end up behind a parameter. `ops/check-fallback-reachable.mjs` fails if
either route leaves the route table, or if the button's render condition ever mentions
`smsConfigured`, `sms_deliveries` or `phone_identit` — with both mutants seeded RED first.

### 6 · Android scope for this run

**Android ships nothing: the enrolment-code sign-in screen, `EnrolmentCode.kt`, `Api.kt` and
the version code are untouched, because a phone offering "Send me an SMS" against a server
that answers 503 is exactly the silent pretence the owner forbade — the `/auth/sms/*` pair is
specified server-side so the app can adopt it in a later run with no server change.**

## Consequences

**Good.**

- The owner's `always` is a property of the code, not a promise in a document: the fallback
  is the state the screen is already in when a send fails, requiring zero extra clicks.
- Zero new columns on `workers`. Zero new npm dependencies. One additive migration with one
  table, and phase 2's `012` is not written until it has a writer.
- Steps 1–4 of the rollout are shippable **today** with the feature permanently off, because
  the live box already lacks the credentials. The day an `AC…` SID and a sender exist, the
  feature turns itself on with a line in `/etc/nfc/env` and a restart — no code, no review,
  no deploy.
- The one phone namespace decision-45 built stays one namespace, and the promotion action it
  named finally exists.
- Nothing added here is read by `POST /shifts/open`. Clock-in is untouched.

**Costs, stated plainly.**

- **`sent` means Twilio accepted it, not that she read it.** No delivery receipts. Upgrade
  path: a signed `POST /sms/status` webhook and a `delivered_at` column — its own decision,
  because it opens a public route.
- A worker can carry two different-looking numbers — free-text `workers.phone` and canonical
  `phone_identities.phone_e164` — which are not asserted to agree. That cost is inherited
  verbatim from decision-45 and is not made worse here.
- `identityPhone()`'s Austria-default ceiling is inherited: a non-Austrian number typed with
  neither `0` nor `+` is refused, not misparsed. No `libphonenumber-js`.
- Phase 2 is **worker-only**. An operator-only `phone_identities` row gets the same `202` and
  no message; operators keep `/auth/operator-code`. Extending it is a follow-up decision.
- Three enrolment mechanisms (Apple, code, SMS) become four with phase 2, and none retires.
  That is more surface to keep correct — mitigated by all of them terminating in the same
  `worker_sessions` row and none of them being reachable from a request body.
- The in-memory limiters inherit `lib/auth.js`'s stated ceiling (per process, reset on
  restart, blind to IP rotation), and the global spend cap inherits it too — so a restart
  loop could, in principle, buy more messages than the cap intends. Named, accepted at this
  scale, same upgrade path as the existing limiters.

**Revisit trigger:** the owner supplies `TWILIO_ACCOUNT_SID` and a sender (phase 1 becomes
live, and §3's boot line must go quiet on the box); or a non-Austrian worker number becomes a
real requirement (promotes `libphonenumber-js` to a decision of its own); or delivery
receipts are asked for (a new public route).
