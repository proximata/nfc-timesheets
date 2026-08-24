---
id: decision-50
title: >-
  Sign in with Apple is retired from the worker app; decision-22's
  session-not-body rule outlives it
date: '2026-08-24 13:06'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

AMENDS decision-22. Relates to decision-8 (German first), decision-26 (the enrolment code,
kept verbatim), decision-45 (`phone_identities` is the one phone namespace), decision-48
(SMS as a door), decision-49 (the iOS entitlement is the owner's one click).

## ⚠ What is retired, and what is NOT

decision-22 contains two separate claims that have always been read as one. They are split
here, and only the first is retired.

| decision-22 said | this record |
| --- | --- |
| **MECHANISM** — worker identity is proved by an Apple identity token, verified server-side | **RETIRED on iOS.** The app offers SMS OTP and the admin-issued enrolment code, and nothing else. No `SignInWithAppleButton`, no `AuthenticationServices` import, no `not_eligible` dead-end screen |
| **STRUCTURE** — `worker_id` comes from the SESSION and NEVER from a request body | **UNTOUCHED, and it must stay true of every new screen.** `POST /shifts/open` still carries no `worker_id`; `OpenShiftRequest` still has no such field; `requireWorkerSession` is still the only source of worker identity |

The structural rule is the part that closed an authentication hole. The mechanism is the
part that was chosen because "every user is on an iPhone and already has an Apple ID" — a
sentence that stopped being the whole story the day the Android app landed (decision-26)
and stopped being true of the iOS app the day SMS shipped (decision-48).

## Context

The owner's instruction, this session: remove Sign in with Apple ENTIRELY from worker login;
leave phone+OTP and the admin-issued enrolment code, both always visible.

**Measured this run, not remembered:**

- `NFCTimeSheets/NFCTimeSheets/ContentView.swift` line 133 — `SignInWithAppleButton` is the
  ONLY control on `SignInView`. An iOS worker today has exactly one door.
- `NFCTimeSheets/NFCTimeSheets/EnrolmentCode.swift` EXISTS and is a clause-for-clause mirror
  of `server/lib/enrolment.js` — but it is wired only to `OperatorSignInScreen`. The WORKER
  code-paste path was never built on iOS. Android has had it since decision-26.
- `server/routes/auth.js` `POST /auth/sms/request` + `/auth/sms/verify` are LIVE and mint the
  identical `ts_worker` cookie. Android drives them; iOS does not call either.
- So "remove Apple" is not a deletion. It is a deletion PLUS the two doors iOS never had.

## Decision

1. **iOS worker sign-in offers exactly two doors, both always composed, never gated.**
   (a) phone number → `POST /auth/sms/request` → 6 digits → `POST /auth/sms/verify`;
   (b) paste the admin-issued enrolment code → `POST /auth/code`.
   No `GET /auth/capabilities` gate on iOS, unlike Android (decision-48 §6.6): Apple's
   removal means a gate that hides SMS can leave a phone with one door, and the owner chose
   two visible doors over a hidden one. A box with SMS switched off answers `503
   sms_not_configured` and the screen says so IN WORDS at the moment of the tap.
2. **`Session.State.ineligible` and `IneligibleView` are DELETED.** `403 not_eligible` is
   producible by `POST /auth/apple` alone; with no caller there is no state to render, and a
   screen for an unreachable state is a screen nobody will see fail.
3. **`POST /auth/apple` STAYS ON THE SERVER, deprecated in words, deleted in a later run.**
   Every TestFlight build already on a worker's phone calls it. Deleting the route strands
   those phones at the sign-in screen until they update, which is the exact silent failure
   this project keeps refusing. `server/lib/apple.js`, `workers.apple_sub` and the JWKS fetch
   stay with it. **Revisit trigger:** the Apple-free build is live on TestFlight AND
   `sms_deliveries` / `worker_sessions` show every worker has re-signed in through a new door.
4. **The `com.apple.developer.applesignin` entitlement STAYS.** Removing a capability is an
   Xcode click and a provisioning-profile regeneration — the owner's, not an agent's
   (decision-49). An unused entitlement is inert; a broken profile is a build that does not
   ship. It is retired in the same later run as the route.
5. **Nothing downstream may learn which door was used.** All three mechanisms terminate in
   `createWorkerSession()`, one `worker_sessions` row, one `ts_worker` cookie, one 90-day
   TTL. That is what makes retiring one of them a UI change and not a data-model change.

## Consequences

**Good.**

- One fewer third-party dependency in the sign-in path, and one fewer App Store review
  surface (guideline 4.8 is about offering OTHER third-party providers; offering none is
  trivially outside it).
- Hide My Email is gone as a failure mode. It produced the entire `IneligibleView` design —
  a relay address a worker reads aloud to a manager who pastes it into a worker record — for
  a crew that mostly does not have an email address on file at all.
- One person, one telephone number, one identity: `phone_identities` (decision-45) already
  is the join key, and it does not silently fork the way `email` + `privaterelay` did.
- iOS and Android finally offer the SAME two doors, so one sentence of onboarding
  instruction is true of both phones.

**Costs, stated plainly.**

- **A worker with NO login number on file and no live enrolment code cannot get in at all.**
  That was already true on Android; on iOS the Apple door used to cover it. The mitigation is
  an admin UI for the login number (TASK-244 AC#4) and it must ship in the SAME run.
- `workers.apple_sub` becomes a column nothing writes. Left in place: dropping a column is a
  migration with no reader and no benefit.
- Three doors become two, and the SMS door depends on a paid third party being configured. If
  Twilio credentials lapse, the enrolment code is the only way in — which is precisely why
  decision-48 refused to let SMS replace it.
- `checks/tag-link-check.swift` loses its `AppleNonce` vector and its `not_eligible` cases.
  Deleting a check is normally a smell; here the code it pinned is gone, and leaving it would
  mean keeping `AppleNonce` alive for the check alone.

**Revisit trigger:** an iPhone-only customer with no phone numbers on file (Apple becomes the
cheapest door again); or the App Store objecting to an account-creation flow with no Apple
option (it does not today — there is no self-service account creation here at all: every
worker row is created by an admin).
