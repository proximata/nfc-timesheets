---
id: TASK-247
title: >-
  iOS: tag_unbound strands a queued offline shift for ever — the iOS half of
  TASK-240
status: Wont Do
assignee: []
created_date: '2026-08-24 13:48'
updated_date: '2026-08-24 17:49'
labels:
  - ios
  - payroll
  - reliability
dependencies: []
priority: high
ordinal: 165000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY THE decision-50/51 VERIFY PASS, NOT FIXED BY IT. TASK-240 is the SAME bug and is
labelled 'android' only; its Modified-files line names ApiFailure.kt and nothing under
NFCTimeSheets/. The iOS half was never filed and is still live.

MEASURED, this run, on committed HEAD 1417464:

  NFCTimeSheets/NFCTimeSheets/API.swift APIFailure.isRetryable now reads

    code == "shift_already_open" || code == "zone_unverified" || (status == 401 && code != "invalid_code")
      || status == 0 || status == 408 || status == 429 || status >= 500

  'tag_unbound' is NOT in it, so a 422 tag_unbound falls through to false.
  Sync.swift line 156 then does shift.syncBlocked = !failure.isRetryable -> true, and nothing
  clears syncBlocked except markOpenSynced / markCloseSynced, neither of which a never-planned
  row can ever reach.

  server/lib/validate.js activePlace() line 575: 'if (reported && reported.resolved_at === null)
  fail(422, "tag_unbound")'. server/routes/app.js line 187 calls activePlace() from
  POST /shifts/open. So iOS CAN hit it, on the ordinary clock-in path.

  grep confirms iOS knows the string in exactly one place — VerifyZoneScreen.swift line 140,
  the OPERATOR verify screen. APIFailure.workerMessage has no case for it, so a WORKER also
  gets generic fallback copy on top of the silent stranding.

THE FAILURE, concretely: an operator mounts a card at a door and reports it; the office has
not resolved it yet (CORE-FLOW.md section 4 step 7 calls that ROUTINE). A cleaner taps it,
works the shift, and the queued open is refused 422 tag_unbound. The admin resolves the tag
an hour later. The identical bytes would now succeed. iOS never retries them. The hours are
lost and nobody is told.

WHY IT IS NOT OBVIOUS: tag_unbound looks like a payload error and every other 422 in this app
genuinely is one. It is not — it is a temporary state of the SERVER's configuration, exactly
like zone_unverified (fixed for iOS in 1417464) and exactly like a lapsed session's 401 (also
fixed in 1417464). The run that fixed the other two did not fix this one.

MUST NOT REGRESS: invalid_code stays TERMINAL. The workerId guard in Sync.swift pushOpen
(shift.workerId == workerId, else syncBlocked with 'logged by a different account') is what
makes retrying safe and must not be touched — it is the client-side half of decision-22.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 APIFailure(status: 422, code: "tag_unbound").isRetryable is true, pinned in NFCTimeSheets/checks/tag-link-check.swift beside the existing zone_unverified vector
- [ ] #2 APIFailure.workerMessage has a case for tag_unbound with German-first copy matching Android's intent, and the string exists in Localizable.xcstrings with a translated German value
- [ ] #3 401 invalid_code stays TERMINAL and 400 invalid_uuid / 422 unknown_worker stay terminal — re-asserted in the same check
- [ ] #4 ./NFCTimeSheets/checks/run.sh green, and RED first: revert isRetryable before adding the assertion and watch tag-link-check fail
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 17:49
---
Same ruling as TASK-240 (its Android twin): piloting/UAT stage, data loss not a concern yet, and an unresolved-tag clock-in correctly not landing is the wanted behaviour. Won't-do.
---
<!-- COMMENTS:END -->
