---
id: TASK-25
title: 'i18n infrastructure (English default, German prepared)'
status: To Do
assignee: []
created_date: '2026-07-28 13:51'
labels:
  - web
  - ios
  - i18n
milestone: m-3
dependencies:
  - TASK-14
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up internationalization framework in both web (next-intl or similar) and iOS (Localizable.strings). All user-visible strings extracted to translation files. English as default. German locale files created with English content as placeholder. No actual German translation yet — infrastructure only so switching is a content task not a code task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All web UI strings come from translation files, not hardcoded
- [ ] #2 All iOS strings use NSLocalizedString or String(localized:)
- [ ] #3 English locale complete
- [ ] #4 German locale files exist (English content as placeholder)
- [ ] #5 Switching locale changes all displayed text
<!-- AC:END -->
