---
id: TASK-39
title: Decide CORS policy explicitly instead of relying on the default
status: To Do
assignee: []
created_date: '2026-08-04 17:45'
labels:
  - server
  - security
dependencies: []
priority: low
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The API sends no Access-Control-Allow-Origin header and has no allowlist. Today that is the SAFE default, not a hole - but it is undecided rather than decided, and the day someone adds a second origin (a client portal on its own domain, a status page, a native web view) the safe default will be in the way and the tempting fix is Access-Control-Allow-Origin: *.

Write the policy down and enforce it in code so the next person cannot widen it by accident.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single allowlist constant in server/lib/, defaulting to the app origin only
- [ ] #2 Wildcard ACAO is impossible to set together with credentials - assert it in server/check-api.js
- [ ] #3 A comment stating WHY the boundary is same-origin (SameSite=Strict does the real work)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN, and deliberately filed LOW rather than as a vulnerability.
The brief listed this as 'the API has no CORS allowlist'. That is literally true, so I checked
whether it is exploitable, and it is not. Reporting what I measured rather than the framing:

READING CROSS-ORIGIN IS ALREADY BLOCKED. Probed live:
  curl -i -H 'Origin: https://evil.example.com' https://timesheets.exe.xyz/admin/data
  -> HTTP/2 401, and NO access-control-allow-origin header in the response.
No ACAO header means a browser refuses to hand the body to cross-origin JS. Absent CORS config is
the restrictive state, not the permissive one - CORS only ever GRANTS access.

WRITING CROSS-ORIGIN (CSRF) IS ALSO ALREADY BLOCKED, which is the part that would actually matter,
because a state-changing POST does not need to read the response:
  server/lib/auth.js:175  `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
SameSite=Strict means the browser will not attach the session cookie to a request originating from
another site at all. server/check-api.js asserts HttpOnly + Secure + SameSite=Strict on both the
admin session cookie (:846-849) and the worker cookie (:733-737).

And there is no cross-origin caller to serve: decision-16 puts the web admin and the API in the
SAME Node process on the same origin, so the frontend never makes a cross-origin request.

SO WHAT IS ACTUALLY WRONG: nothing is broken; the boundary is undocumented and unasserted. Three
guarantees are load-bearing (no ACAO, SameSite=Strict, same-origin frontend) and only the cookie
attributes have a test. Someone adding a client-portal subdomain would meet a CORS error with no
comment explaining the intent, and ACAO:* is the first search result.

WHAT BREAKS IF NEVER DONE: nothing today. The risk is future-tense and mitigated by the cookie.
Do not let this jump the queue ahead of worker_rates or the offsite backup.

ponytail: this is one constant and one assertion, not a cors middleware package. Do not add a
dependency for a policy that is currently the word 'no'.
<!-- SECTION:NOTES:END -->
