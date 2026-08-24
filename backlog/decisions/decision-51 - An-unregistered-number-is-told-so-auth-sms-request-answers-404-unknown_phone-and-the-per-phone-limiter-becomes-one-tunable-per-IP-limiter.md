---
id: decision-51
title: >-
  An unregistered number is told so: /auth/sms/request answers 404 unknown_phone
  and the per-phone limiter becomes one tunable per-IP limiter
date: '2026-08-24 13:10'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

AMENDS decision-48 §6 (and `backlog/docs/SMS-ONBOARDING.md` §6.1 and §6.4). Relates to
decision-45 (`phone_identities`), decision-26 (the enrolment code, untouched), decision-50
(Apple retired, so SMS is now one of only two doors), decision-16 (`pg` and no framework).

## ⚠ THE THREAT MODEL CHANGED. It was changed by the owner, explicitly, not derived here.

decision-48 §6 rests on ONE assumption, stated there as fact:

> `202` **IDENTICAL for a known and an unknown number** … it cannot be a lie for an unknown
> number and cannot become an enumeration oracle.

The owner has waived that concern for this deployment: **assume no attacker who will probe
numbers.** The customer is one Viennese cleaning company with a crew in the low tens, behind
an app-key gate, and the asset an enumeration would yield is "this phone number belongs to
somebody who cleans buildings".

| decision-48 §6 said | amended to |
| --- | --- |
| `202 {status:"accepted"}` **byte-identical** for known and unknown numbers | `202` for a number that resolves to an ACTIVE worker; **`404 {"error":"unknown_phone"}`** for one that does not |
| per-phone limiter, `3/rolling hour + 10/rolling 24h`, **spent for unknown numbers too so the limiter is not an oracle** | **DELETED.** Its entire stated purpose was making unknown numbers behave like known ones. With the 404 there is nothing left for it to hide |
| four limiters (§6.4 table) | **three**: per challenge (5 wrong answers, DB), per IP on verify (`smsotp:`), global spend — plus the NEW per-IP-on-request bucket below |

Everything else in §6 stands unchanged, and two clauses are deliberately reaffirmed:
`POST /auth/sms/verify` keeps its ONE byte-identical `401 invalid_code` for every failure —
the honesty added here is at REQUEST time only, where the worker can act on it. And
`checkGlobalSmsSpend` (20/rolling hour, 100/rolling day) and `checkGlobalOtpVerifyRate`
(60/min) are NOT retuned and NOT reordered: one guards a telephone bill, the other guards a
6-digit secret, and neither is what this record is about.

## Context

The owner's sentence: a worker whose number is not on file must be told so **when they ask
for the code**, not left waiting for a text that is never coming, and not told at verify time
where the only honest answer is "wrong code".

**Measured this run, not remembered:**

- `server/routes/auth.js` `smsRequest()` — an unknown number, an operator-only
  `phone_identities` row and a DEACTIVATED worker all return `202 {status:"accepted"}` and
  send nothing. `server/check-sms-flag.mjs` §4 asserts exactly that, twice.
- `checkOtpRequestRate(phoneE164)` in `server/lib/auth.js` buckets on the NORMALISED number
  and its own comment names anti-enumeration as the reason it counts unknown numbers.
- `clientIp(req)` already exists in `server/server.js` and is already the bucket key for
  `checkLoginRate`. `spendRolling()` already exists and already takes a rules array.
- `app_settings` + `POST /admin/settings` + `DELETE /admin/settings/:key` + the `SETTINGS`
  allowlist already exist (migration `005`, `pl_margin_baseline_bp`).

## Decision

**1 · `404 {"error":"unknown_phone"}`, and not any of the four alternatives.**

The number is well-formed; the resource does not exist. `404` is the only status in this
codebase that already means that, and `unknown_*` is already the house code family
(`unknown_worker`, `unknown_location`, `unknown_shift`, `unknown_request`). Rejected:

- `422 invalid_phone` — SHAPE ONLY. Reusing it would make "you typed it wrong" and "we do not
  have you" the same sentence, which is the confusing-copy defect this project keeps hitting.
- `503 sms_not_configured` — a property of the SERVER, not of a person.
- `403` — implies an authorisation decision. Nobody was authorised or refused; nothing exists.
- `200 {registered:false}` — a success status for a request that did nothing.

A `404` on an EXISTING route is distinguishable from the router's own unrouted `404
{"error":"not_found"}` by CODE, and both phones branch on the code, never the status.

**2 · The 404 covers exactly one predicate: the phone does not resolve to an ACTIVE worker.**
Unknown number, operator-only row, and DEACTIVATED worker all answer `404 unknown_phone`. The
deactivated case is deliberate and is not a leak of a personnel decision: the worker's correct
next action — "contact your employer" — is the same sentence either way, and a `202` there
would be the silent pretence in its purest form.

**3 · One per-IP request limiter, N per rolling 5 minutes, N from `app_settings`.**

```
key      sms_otp_requests_per_5min      (app_settings, TEXT, like pl_margin_baseline_bp)
window   5 minutes                      FIXED IN CODE. The key names it so it cannot drift
default  3                              WHEN UNSET. Never unlimited, never 0
clamp    1 .. 20                        write-time 400 invalid_field; read-time fallback
bucket   `smsreq:${clientIp(req)}`      the existing clientIp + the existing spendRolling
```

The clamp bounds are CONFIRMED as the owner proposed them, for a reason worth writing down:
the floor of 1 exists because 0 is a company-wide lockout typed by accident, and the ceiling
of 20 exists because it is the point past which this limiter stops binding at all — 20 per
5 minutes is 240/hour against a `checkGlobalSmsSpend` ceiling of 20/hour, so the bill cap
becomes the operative limit and the per-IP number becomes decoration. **A misconfiguration of
this key can therefore never cost more than 20 messages an hour.** That is the property that
makes an admin-tunable value safe here.

**4 · Unset must fall back, never open and never shut.** Unlike `pl_margin_baseline_bp`
(absent = the P&L flags nothing, a feature toggle), an absent rate limit is a security
control that is missing. Read-time is `Number.isSafeInteger(n) && n >= 1 && n <= 20 ? n : 3` —
so a row somebody wrote with `psql`, a `NULL`, a float or `"drei"` all land on 3.

**5 · The value is read from the database ON EVERY REQUEST**, so `POST /admin/settings` takes
effect without a restart and without a cache to invalidate. *ponytail:* CEILING — one indexed
primary-key lookup on a two-row table is now on a public, app-key-gated route BEFORE the
limiter refuses, so a flood costs one query per request instead of zero. Accepted at one box,
one systemd unit, ~20 workers. UPGRADE PATH: memoise for 30 s in the same module; the call
site does not change.

**6 · Call order inside `smsRequest`, unchanged except for the swap.**
`smsConfigured()` → `identityPhone()` → **per-IP limiter (was: per-phone)** → global spend →
resolve the phone → `202` + send, or `404 unknown_phone`. The IP bucket is spent BEFORE the
database is touched, including for a number that turns out to be unknown: a refusal must be
cheaper than the work it refuses, and a free unauthenticated lookup is a DoS lever whatever
the enumeration policy is.

## Consequences

**Good.**

- A worker whose number was never put on file is told, in German, at the moment they ask, and
  the sentence names the action: contact the employer or administrator. Today they wait for a
  text that cannot arrive.
- One limiter instead of two, and the surviving one is the same idiom `/admin/login`,
  `/auth/code`, `/auth/operator-code` and `/auth/sms/verify` already use.
- SMS-bombing one handset is still bounded — by the per-IP bucket and by the 20/hour bill cap
  — it is simply no longer bounded by a rule whose only justification was hiding a fact the
  owner now wants told.
- The admin can raise the limit from the panel-facing settings route the day a crew reports
  being locked out, without a deploy.

**Costs, stated plainly.**

- **Number enumeration is now possible**, at N per 5 minutes per source address, and this is a
  deliberate, owner-signed trade. If the customer profile ever changes — a second tenant,
  public sign-ups, a bigger crew — this record is the thing to revisit FIRST.
- **NAT and CGNAT make the per-IP bucket coarser than it reads.** A crew enrolling together on
  one office Wi-Fi, or several phones behind one Austrian mobile carrier's CGNAT, share a
  bucket: with the default of 3 the fourth person in five minutes is refused. Mitigations, in
  order: the enrolment code path is entirely unaffected and is one tap away; the limit is
  tunable to 20 without a deploy. Named, not designed around.
- **A typo spends budget.** A worker who mistypes twice has one attempt left in the window.
  This is the direct cost of spending the bucket before the lookup, and it is preferred to a
  free unauthenticated database probe.
- An unregistered number still spends one unit of the process-wide `checkGlobalSmsSpend`
  budget, because that call keeps its current position. Now visible, because the caller is
  told what happened. UPGRADE PATH: move that call below the lookup — its own decision,
  deliberately not taken here.
- Three server checks currently ASSERT the retired behaviour and must be rewritten, not
  deleted: `server/check-sms-flag.mjs` (byte-identical known/unknown; deactivated → 202; the
  per-phone ceiling), `ops/prove-sms-live.sh` §4, and `server/check-sms-mutants.sh`'s seeded
  RED cases. A check that is deleted rather than inverted is a property that quietly stopped
  being true.

**Revisit trigger:** a second customer on the same box; any public or self-service sign-up;
a report of legitimate workers hitting `429` from one office address (raise the key first,
then reconsider the bucket key); or Twilio spend that the 20/hour cap did not stop.
