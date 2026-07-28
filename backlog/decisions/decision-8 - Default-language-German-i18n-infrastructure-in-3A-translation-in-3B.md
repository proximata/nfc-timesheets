---
id: decision-8
title: Default language German - i18n infrastructure in 3A, translation in 3B
date: '2026-07-28 13:51'
status: accepted
---
## Context

Product operates in Vienna. Default language must be German. All UI text must be translatable. But MVP development is faster in English — translating every string slows iteration.

## Decision

3A: build i18n infrastructure (next-intl for web, String(localized:) for iOS). All strings externalized to translation files. English as development language. German locale files created with English content as placeholder. 3B: actual German translation as a content task, not a code task.

## Consequences

- No hardcoded strings from day one — switching locale is config change
- German users see English in 3A pilot (acceptable for internal crew)
- Translation can be done by non-developer (hand off .json/.strings files)
