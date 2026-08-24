---
id: TASK-267
title: >-
  Android: the sign-in screen buries one field and one button under five
  paragraphs of explanation
status: To Do
assignee: []
created_date: '2026-08-24 19:09'
labels:
  - android
  - ux
  - worker
dependencies: []
priority: low
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey, step 'Cleared app data for a true first-launch state, relaunched the app, captured the initial sign-in screen'. Driven live on the ts-demo emulator, screenshot 01-signin.png.

WHAT WORKS AND MUST NOT BE LOST: it IS obvious which field an ordinary worker uses. The intro sentence is specific ('Geben Sie den Anmeldecode ein, den Sie von Ihrer Verwaltung bekommen haben.'), the field is labelled 'Anmeldecode', the SMS block introduces itself with its own question ('Ihre Verwaltung hat eine Telefonnummer fuer Sie hinterlegt?'), and the operator section names itself out for anyone who is not one. The sign-in itself was one code, one tap, first attempt — exactly decision-26's intent.

THE FRICTION IS LENGTH ONLY: five-plus paragraphs of help and legal-style text stack above and below the single button a first-time user needs, so the very first screen a new hire sees reads as a document rather than a one-tap sign-in. This is the lowest-severity item in the whole UAT pass and is filed as such.

FIX SHAPE: keep every sentence, change what is visible first. The code field, its one-line instruction and the Anmelden button lead; the SMS block and the operator block stay where they are but collapse behind their own one-line headings; any legal or explanatory paragraph moves behind a disclosure. NOTHING TRUE MAY BE DELETED to shorten the screen — that rule has been enforced across this product's redesign work and applies here.

Do not reorder the two sign-in doors relative to each other or make either harder to reach: decision-48 makes them interchangeable for the same worker, and the journey confirmed both work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On first launch the Anmeldecode field, its instruction and the Anmelden button are visible without scrolling on a common phone screen
- [ ] #2 Every sentence currently on the screen still exists — collapsed or behind a disclosure, never deleted
- [ ] #3 The SMS door is still reachable in one tap and is still discoverable without prior knowledge
- [ ] #4 The Betreiber section stays reachable without a worker sign-in (TASK-254 depends on that surface)
- [ ] #5 de and en strings.xml keep exact key parity
<!-- AC:END -->
