---
id: TASK-279
title: >-
  iOS: decision-49 section 4 was never implemented — the operator shares the
  worker's URLSession and cookie jar
status: To Do
assignee: []
created_date: '2026-08-26 18:08'
labels:
  - ios
  - decision-49
  - tech-debt
dependencies: []
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PRE-EXISTING, found by TASK-275 (review gate) while reviewing the decision-54 rollout. Present at 56440ea, so it is NOT this session's doing — but it is what makes TASK-276 reachable.

decision-49 (ACCEPTED) section 4 is explicit and structural:
'So OperatorAPI gets its own URLSession with httpShouldSetCookies = false and httpCookieAcceptPolicy = .never, sets Cookie: ts_operator=<token> by hand from its own store, and never posts .sessionRejected. Two sessions, two jars, no request that carries both.' Plus: 'The token lives in the Keychain, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, not in UserDefaults.'

MEASURED:
- OperatorAPI.swift:65 uses URLSession.shared. Its own header (:19-24) states the opposite of the decision as if it were the design: 'PERSISTENCE IS STILL EXACTLY THE WORKER'S MECHANISM ... the very same HTTPCookieStorage.shared jar that already keeps ts_worker alive'.
- No hand-managed token store and no Keychain use anywhere; OperatorSession.swift:100-101 keeps only id+name in UserDefaults.
- The one clause that IS honoured: OperatorAPI never posts .sessionRejected (OperatorAPI.swift:59, sendOperator).

TWO CONSEQUENCES decision-49 section 4 named in advance, both live today:
1. Every worker request carries ts_operator and vice versa — the property Android gets structurally (separate stores, core/SessionCookie.kt) and iOS does not.
2. Auth.swift:176-181 clearLocalSession() deletes EVERY cookie for API.base, so a WORKER signing out silently ends the OPERATOR's session. Exactly the failure the decision predicted.

Either implement section 4 as written, or write the decision record that supersedes it — decisions change only by a new decision (AGENTS.md). Do not leave a file header asserting the opposite of an accepted decision.

MUST NOT REGRESS: OperatorAPI must still never post .sessionRejected; an operator signing out must still leave ts_worker alone (OperatorSession.swift:106-116 already does this correctly by cookie NAME, not by host).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 OperatorAPI uses its own URLSession with httpShouldSetCookies=false and httpCookieAcceptPolicy=.never, or a superseding decision record exists
- [ ] #2 no request carries ts_worker and ts_operator together
- [ ] #3 a worker sign-out leaves a live operator session intact
- [ ] #4 OperatorAPI.swift's header no longer contradicts decision-49
<!-- AC:END -->
