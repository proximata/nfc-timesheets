---
id: TASK-296
title: 'Review gate: decision-57 feature flags + playful shift screen'
status: To Do
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 10:45'
labels:
  - review
  - decision-57
dependencies:
  - TASK-292
  - TASK-293
  - TASK-294
  - TASK-295
priority: medium
ordinal: 214000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 re-read decision-57 in full; confirm flag OFF is byte/pixel-identical to pre-decision-57 behavior on both platforms
- [ ] #2 confirm a flags-role admin session is refused on every admin route except /admin/flags (spot-check at least 3 other routes)
- [ ] #3 confirm the animation never covers/obscures the state words under the clock on either platform
- [ ] #4 entitlements/pbxproj/IPHONEOS_DEPLOYMENT_TARGET byte-identical across the whole commit range
- [ ] #5 all relevant check suites run with output quoted; existing wallpaper/brand checks specifically re-run and shown still green
- [ ] #6 nothing pushed, nothing deployed; note that provisioning the real second admin account on production is a manual owner/assistant follow-up, not part of this gate
<!-- AC:END -->
