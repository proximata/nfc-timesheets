---
id: TASK-136
title: 'Redesign foundation: token layer in globals.css'
status: Done
assignee: []
created_date: '2026-08-17 11:19'
updated_date: '2026-08-17 13:31'
labels:
  - ux
  - redesign
dependencies: []
references:
  - docs/brand/prototype.html
documentation:
  - backlog/docs/REDESIGN-PLAN.md
priority: high
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the light-only :root token block in web/app/globals.css with the approved prototype's dark-default set, plus [data-theme="light"]. Accent is BLUE: oklch(.72 .17 250) dark, oklch(.55 .12 250) light. Exact values in REDESIGN-PLAN.md section 1.1.

Legacy tokens (--bg, --surface, --ink, --ink-muted, --accent-soft, --focus, --space-*) become ALIASES of the new names so ~1000 lines of existing CSS keep working in dark mode without a big-bang rename across files owned by other agents (section 1.2). Superseded rules listed in section 1.3 are deleted in the same change, EXCEPT .worker-form and the button aliases which the cleanup task removes.

Three additions the prototype does not contain but the product needs (section 1.4): color-scheme, a light-pinned .portal subtree, an @media print light set, and the 3px state rule placed on the first CELL because a border on <tr> under border-collapse:collapse silently does not paint.

NO new dependency. 'Inter' is a font-family name only - no @font-face, no next/font, no download. Sole writer of globals.css for the whole workstream.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web/app/globals.css :root carries the exact token names and values from REDESIGN-PLAN.md section 1.1, including color-scheme: dark
- [x] #2 [data-theme="light"] block present with the prototype's light values and color-scheme: light
- [x] #3 Legacy aliases --bg/--surface/--ink/--ink-muted/--accent-soft/--focus/--space-1..8 resolve to the new tokens; no screen file was edited to achieve this
- [x] #4 Every rule named dead in section 1.3 is deleted, except .worker-form, .button-primary, .button-secondary which are left for the cleanup task; no rule appears in both old and new form
- [x] #5 .portal renders light and /reinigung/ is visually unchanged from before the change
- [x] #6 @media print resolves to the light token set
- [x] #7 MUTATION TEST recorded: the 3px left state rule set to transparent on purpose makes the /shifts/ screenshot visibly change, then is restored
- [x] #8 package.json dependencies are byte-identical to before
- [x] #9 cd web && pnpm lint && pnpm typecheck && pnpm build all green, and a screenshot of the UNTOUCHED /workers/ shows the legacy markup rendering correctly in dark mode
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Tokens landed in web/app/globals.css (sole writer). :root is the dark set + color-scheme: dark; [data-theme="light"] mirrors it. Accent BLUE oklch(.72 .17 250) / oklch(.55 .12 250).

Legacy names kept as ALIASES in the same :root (--bg/--surface/--ink/--ink-muted/--accent-soft/--focus/--space-1..8), so all 13 unmigrated screens render correctly in dark mode with zero edits to files other agents own. Marked SUNSET for B6.

Superseded rules deleted, not duplicated. Where a shipped class name still appears in unmigrated screens it SHARES the new rule via one selector list rather than existing beside it: .shift-state-* and .material-stage-* share .badge.open/.unres/.corr/.muted; .row-attention and .row-inactive share the new left-rule/muted-text mechanism. .page-summary and the .callout card chrome are gone. .worker-form, .button-primary, .button-secondary kept as thin aliases for B6.

Additions the prototype lacks: color-scheme; --danger/--ok (the shipped #a4262c/#1c6b3c are unreadable on #0B0C0E and an unreadable error is an error that did not happen); .portal re-declares the full light set so a client's page is not darkened; @media print resolves light; the 3px state rule sits on the first CELL because a border on <tr> under border-collapse:collapse silently does not paint.

MUTATION TEST (AC#7), recorded: setting .is-unres/.row-attention border-left-color to transparent turned demo/check-foundation.mjs RED -- 'state rule: the 3px left rule is painted on the first CELL {"unres":"rgba(0, 0, 0, 0)"}' -- and restoring it turned it green.

A REAL regression the check caught: a .visually-hidden group heading inside the phone nav strip is positioned against the initial containing block, escapes the strip's clip and widens the document to 1305px at a 390px viewport. Fixed with .nav-group { position: relative }.

pnpm verify green. package.json byte-identical.
<!-- SECTION:NOTES:END -->
