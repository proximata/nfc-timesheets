---
id: TASK-45
title: 'Enrolment codes: configurable lifetime, and a longer default'
status: To Do
assignee: []
created_date: '2026-08-04 18:27'
labels:
  - server
  - web
  - auth
  - ux
dependencies: []
priority: high
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE REPORTED PROBLEM. The owner issued a code, sent it to one person, and it expired before that person used it. The mental model when sending a code is 'valid until claimed'; the actual behaviour is 'valid for 60 minutes'. server/lib/enrolment.js:66 hardcodes CODE_TTL_MS = 60 * 60 * 1000. Nothing in the admin UI states the deadline at the moment of sending, so the expiry is invisible until it has already bitten.

WANTED. (1) A longer default. (2) The lifetime configurable rather than compiled in - decide deliberately between an env var (one value for the whole install) and a choice at issue time in the UI (1 hour / 1 day / 7 days). Per-issue is friendlier for the real journey - phone the worker, they install the app later that evening - but it is one more control on a screen the director already finds busy.

THE SECURITY ARITHMETIC IS LOAD-BEARING AND MUST BE REDONE. enrolment.js:40-55 carries the brute-force calculation that justifies the whole mechanism, and it says in terms: 'If the alphabet, the length, the TTL or either limit changes, redo this block. It is the justification for the whole mechanism, not decoration.' A longer TTL widens the guessing window LINEARLY and the search space is SHARED across every live code, so the sums must be rewritten in the file, not waved through. Sketch for orientation only, to be redone properly: 8 chars over a 32-char ambiguity-free alphabet is 32^8 (about 1.1e12); at the existing 30/min global ceiling a 24-hour code sees about 43_200 guesses, which stays several orders of magnitude from a hit. That suggests 24h or even 7 days is defensible WITHOUT lengthening the code - but confirm it, do not assume it.

MUST NOT REGRESS (decision-26 and the original build): codes stay single-use, enforced atomically in the database so two racing redemptions still yield exactly one session; stored hashed, never logged; expired, already-redeemed, unknown and inactive-worker responses stay BYTE-IDENTICAL in status, body and headers; revoke stays one click and as obvious as issue; rate limits stay. The UI keeps calling it a Zugangscode and never says token, hash, credential or grant.

UX, which is where this failure actually happened: the screen must state the expiry PLAINLY at the moment the code is shown and copied, in German, in absolute local terms the director can paste into a message - not a relative 'expires in 60 minutes' that is wrong the moment it is read. Show the deadline on the worker row while a code is live, and make an expired code visibly distinguishable from no code at all, so the recovery is obvious instead of another phone call.

Also worth deciding while here: whether an expired-but-unclaimed code can be re-sent unchanged rather than forcing a new value, since re-issuing invalidates the message already sent to the worker.
<!-- SECTION:DESCRIPTION:END -->
