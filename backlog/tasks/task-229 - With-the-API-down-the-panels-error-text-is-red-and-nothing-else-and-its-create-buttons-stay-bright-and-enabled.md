---
id: TASK-229
title: >-
  With the API down, the panel's error text is red and nothing else, and its
  create buttons stay bright and enabled
status: To Do
assignee: []
created_date: '2026-08-21 00:18'
labels: []
dependencies: []
priority: medium
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two things stay wrong on the admin panel when the API is unreachable. Both were seen by stopping postgresql on production and photographing the screens; neither is fixed.

1. .form-error IS COLOUR AND NOTHING ELSE.

app/globals.css:566
  .form-error { margin: 0; color: var(--danger); font-size: 0.875rem; }

Colour, and type SMALLER than body text. That is the class carrying the most consequential sentence in the panel — "Das hat gerade nicht funktioniert" — and desaturating the screenshot makes it read as less important than the paragraph beneath it. The house rule is that colour is always the SECOND signal: a desaturated screenshot must still be readable.

The contradiction that made this acute is fixed (commit 5456650: the twelve screens now say the error where the spinner was, so nothing louder disagrees with it). What is NOT fixed is the class itself. Any screen that shows .form-error next to ordinary body copy still relies on red alone to rank them.

WHAT WOULD FIX IT, without inventing decoration: weight and size, not a glyph. Give .form-error the same font-size as body copy and a heavier weight, or a left rule in --danger the way .notice.bad already has one. The existing .notice.bad is the precedent in this codebase and it already survives desaturation.

DO NOT: add an emoji or a ⚠ character. This panel is German business software for one director, and the words are the signal.

2. PRIMARY ACTIONS STAY FULLY ENABLED ON A DEAD SCREEN.

On /objekte with the database down, "Objekt anlegen" is a bright blue, fully enabled primary button on a page that has just said it cannot reach the server. Pressing it opens a form that cannot save. Same shape on /mitarbeiter, /kunden and the rest.

This is lower severity than (1) — the save fails with its own message, so nothing is lost — but it is the panel promising something it cannot do, and it costs the director a round trip to discover it.

FIX: disable the create action while loadError !== null and the screen has no data, with the reason in the title attribute rather than a tooltip nobody hovers.

ACCEPTANCE:
- shown RED first: a desaturated screenshot in which .form-error is indistinguishable in rank from the body copy next to it, then the same shot after the change
- demo/check-ia-greyscale.mjs (which already exists) extended to cover the error class, or a note in it explaining why it cannot
- no new dependency, 390px still works, de/en key parity unchanged
<!-- SECTION:DESCRIPTION:END -->
