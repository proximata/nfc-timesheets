---
id: TASK-208
title: >-
  The TagLink corpus is two hand-written lists that happen to agree, and one
  names the wrong host
status: To Do
assignee: []
created_date: '2026-08-20 04:04'
updated_date: '2026-08-27 07:57'
labels:
  - android
  - ios
  - security
  - measured
dependencies: []
priority: medium
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED at 8702615. ops/workflows/w2 calls 'the cross-platform TagLink corpus' a standing battery. THERE IS NO SUCH ARTEFACT. What exists is two independently written case lists and a comment:

  android/checks/core-check.kt              14 reject cases + a legacy-host set
  NFCTimeSheets/checks/tag-link-check.swift  8 reject cases
  core-check.kt:141  // Verified against Swift: cat NFCTimeSheets/{Branding,TagLink,API}.swift

Kotlin's 14 are a strict SUPERSET of Swift's 8, and the extra six are the security-relevant ones: https://host@evil.example.com, https://evil-host, https://host.evil.example.com, the lenient-parser uuid 1-1-1-1-1, and leading/trailing '+'. So the two agree today, by hand, and NOTHING WOULD NOTICE IF THEY STOPPED.

And they already disagree about one thing: tag-link-check.swift hardcodes schimmer-glanz.exe.xyz as the TAG host. That is the pre-decision-40 single-host model. iOS's Associated Domains entitlement carries the same literal. Universal links work today only because the API host also serves the association files as a fallback - so the day the API host is renamed, iOS taps break and Android taps do not.

node ops/check-branding.mjs reports this as a standing TODO and passes (14 assertions OK). It is reported, not fixed: iOS is out of scope for the runs that found it, and moving it is an Xcode build. TASK-188 is the iOS half.

What it costs: nothing today. It is a trap laid for the next host rename, which decision-40 exists to make safe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 one corpus file is the single source of the reject/accept cases, and both android/checks/core-check.kt and NFCTimeSheets/checks/tag-link-check.swift read it rather than restating it
- [ ] #2 the corpus contains at least the 14 Kotlin cases; no case is lost in the merge - diff the old lists against the new corpus and show the count
- [ ] #3 the negative case is exercised: delete one case from the corpus and BOTH checks change their assertion count
- [x] #4 tag-link-check.swift stops hardcoding schimmer-glanz.exe.xyz as the tag host, or TASK-188 is linked as the blocker and the file says so in a comment
- [ ] #5 ops/workflows/w2's description is corrected to match what exists
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC4 satisfied as a side effect of TASK-188/decision-53 (this session). tag-link-check.swift no longer hardcodes schimmer-glanz.exe.xyz as the TAG host - all 17 tag-host literals now read timesheets.exe.xyz; the one remaining schimmer-glanz.exe.xyz reference (line 27) is API.base, the correct apiHost per decision-40's split, not the bug this AC named. The reject-case corpus was also substantially synced by hand: Swift now has 13 cases (was 8), including the userinfo trick, the lenient-parser uuid 1-1-1-1-1, and both leading/trailing + traps that were previously Kotlin-only - Kotlin has 14. STILL OPEN, real gap remains: AC1 (one corpus file both platforms read, not two hand-synced lists) is not built - the two still restate each other, off by one case (13 vs 14). AC3 (negative case: deleting one entry changes both checks) therefore cannot exist yet either. AC5 also unmet: ops/workflows/w2*.mjs:129 still calls it 'a standing battery' cross-platform corpus, which is still not literally true. Left status To Do - real work remains, just less than originally scoped.
<!-- SECTION:NOTES:END -->
