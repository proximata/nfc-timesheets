---
id: TASK-25
title: 'i18n infrastructure (English default, German prepared)'
status: Done
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-04 16:50'
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
- [x] #1 All web UI strings come from translation files, not hardcoded
- [x] #2 All iOS strings use NSLocalizedString or String(localized:)
- [x] #3 English locale complete
- [x] #4 German locale files exist (English content as placeholder)
- [x] #5 Switching locale changes all displayed text
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, AND OVERSHOT: German is a real translation, not a placeholder.

AC1/AC3/AC4: web/messages/en.json and de.json, 817 leaf strings EACH (counted). next-intl 4.12.0
per decision-17. AC5: web/components/LocaleSwitcher.tsx + IntlProvider.tsx.
AC2: NFCTimeSheets/NFCTimeSheets/Localizable.xcstrings — 112 keys, and all 112 carry BOTH `en`
and `de` localizations (counted, not assumed). Android: android/app/src/main/res/values*/.
The /t landing page keeps every user-visible string in one marked <main> block so translating it
is a block swap, not a hunt.

decision-8 has been carried further than this task asked: German is now the SHIPPING default,
baked at build time by ops/deploy.sh:44 (`NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm verify`) precisely
so that an untracked per-developer web/.env.local cannot decide what language the director sees
in production. Live confirmation: the payroll page returns `<h1>Lohnabrechnung</h1>`.

TWO REAL GERMAN DEFECTS SURVIVE, filed separately (pluralisation on the migration receipt):
  "%1$lld alte Schicht%2$@ braucht Ihre Verwaltung"  renders "4 alte Schichts"
  "Wir haben %1$lld alte%2$@ Eintrag/Einträge bereinigt" renders "4 altes Eintrag/Einträge"
Cause: the English builds its plural by appending "s" (MigrationReceiptView.swift:35,48) and the
German string was translated around that hole instead of using a plural rule.
<!-- SECTION:NOTES:END -->
