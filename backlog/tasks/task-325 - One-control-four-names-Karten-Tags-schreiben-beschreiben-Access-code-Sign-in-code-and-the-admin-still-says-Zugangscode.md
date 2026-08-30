---
id: TASK-325
title: >-
  One control, four names: Karten/Tags, schreiben/beschreiben, Access
  code/Sign-in code, and the admin still says Zugangscode
status: To Do
assignee: []
created_date: '2026-08-29 23:04'
labels:
  - i18n
  - ux
dependencies: []
priority: medium
ordinal: 243000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The UX unification pass renamed Zugangscode -> Anmeldecode in both apps' GERMAN, and stopped there.
Four drifts survive, three of them visible on one screen at a time:

  iOS sign-in row       'Karten schreiben oder pruefen'
  its own subtitle      'Tags beschreiben oder pruefen'   (two lines below the row)
  Android same control  'Tags beschreiben oder pruefen'
  -> Karte != Tag and schreiben != beschreiben, same control, same product.

  Android en: 'Sign-in code'      vs   iOS en: 'Access code' / 'Operator code'
  -> the German rename landed on both, the English rename landed on neither consistently.

  web/messages/de.json + en.json still say Zugangscode / access code (~25 strings)
  -> the admin mints a code under one name and the worker's phone asks for another.

This is the class of bug web/scripts/check.mjs cannot see: it proves en.json and de.json agree
with EACH OTHER, never that three platforms agree on a word.

Do it as ONE glossary commit across web + android + iOS, both languages each, or it drifts again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 one German term and one English term per concept across web, Android and iOS
- [ ] #2 web/messages/de.json and en.json use the same term the apps use
- [ ] #3 iOS row title and its own subtitle agree
- [ ] #4 pnpm verify green, and both apps' de/en files edited in the same commit
<!-- AC:END -->
