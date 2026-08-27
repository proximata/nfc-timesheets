---
id: TASK-293
title: 'Admin web: Flags page (list + toggle), reachable by admin and flags roles'
status: Done
assignee: []
created_date: '2026-08-27 10:38'
updated_date: '2026-08-27 16:10'
labels:
  - web
  - decision-57
dependencies:
  - TASK-292
priority: low
ordinal: 211000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 new /flags admin page lists feature_flags rows with a toggle each, calling PATCH /admin/flags/:name
- [x] #2 nav entry visible to both admin roles; every OTHER existing admin nav item/page still refuses a flags-role session with the same treatment as logged-out
- [x] #3 de.json/en.json get the new keys, pnpm verify passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-296 review gate, 2026-08-27: verified independently, PASS.
web pnpm verify exit 0 - check.mjs (en/de key-set parity, ICU/plural parity, non-empty
values), biome, tsc, next build with /flags prerendered static. i18n checked the way the
project rule says it must be (the parity check alone cannot see a hardcoded page): app/flags/
page.tsx calls useTranslations('flags') + useTranslations('error') and every visible string
goes through t() - a grep for JSX text literals finds none. Both message files carry the full
'flags' namespace plus nav.flags ('Feature-Flags' / 'Feature flags'). Nav entry sits in the
account group, visible to both roles, which is right: the nav is static and every other entry
answers a flags-role session the same 401 as logged out.
<!-- SECTION:NOTES:END -->
