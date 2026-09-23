---
id: TASK-348
title: Refine product landing illustration scrolling and product narrative
status: Done
assignee: []
created_date: '2026-09-23 17:19'
updated_date: '2026-09-23 18:00'
labels: []
dependencies: []
priority: high
ordinal: 265000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User reports landing cannot scroll, phone obscures cleaner, anatomy is awkward, and lower content is too sparse. Prioritize a polished trustworthy public product experience.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Desktop and mobile can scroll from hero to footer and submit the trial form
- [x] #2 Compare three visual directions and record selected direction with independent design critique
- [x] #3 Cleaner and mop illustration has clear proportions and readable NFC to dashboard animation without overlap
- [x] #4 Lower sections explain workflow reporting and planning in complete DE and EN with reduced motion support
- [x] #5 Real browser checks and before-after captures accompany pnpm verify results
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reproduce scrolling; capture baseline; create three visual concept variants; select with critic; fix public layout; redraw hero SVG and add useful product narrative; browser-check desktop/mobile DE/EN and reduced motion.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Compared three actual HTML concept variants in captures/company-workspaces/design-refresh/concepts.html. Independent Sol critic chose warm field-journal landing plus operational-clarity app/admin. Root cause: desktop html/body overflow hidden applied to public pages; now restricted to roots containing .app-shell. New cleaner holds a correctly scaled phone, has distinct feet and mop; result tile and bounded NFC/data animation. Added day timeline and FAQ DE+EN. Independent browser: desktop scroll/anchors/FAQ/language/required/email validation/synthetic request success; DB confirms trial persisted. Narrow Chrome viewport measured 433 CSS px (390 requested, zoom affected), footer reachable and no horizontal overflow. IAB viewport override ineffective; no claim of exact390 visual QA. pnpm build/typecheck/lint pass with existing payroll lint warning; pnpm verify still fails four unchanged Windows path checks. Before/after/full-page screenshots saved.

Final independent gate read 65 ADRs and approved current changes. Reviewer caught reduced-motion pulse regression during CSS cleanup; fixed and re-reviewed. All four SVG animation classes have reduced-motion overrides. Final web build passed; verify baseline remains four Windows path failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed public scrolling without breaking fixed admin shell; replaced overlapping phone illustration with cleaner/mop/NFC/result composition and added bilingual day timeline/FAQ. Real desktop/narrow browser flows and local database trial persistence verified. Before/after report and concept variants: captures/company-workspaces/design-refresh/report.html and concepts.html. Build/typecheck/Biome pass; documented existing verify failures.
<!-- SECTION:FINAL_SUMMARY:END -->
