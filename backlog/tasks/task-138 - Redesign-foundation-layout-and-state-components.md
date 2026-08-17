---
id: TASK-138
title: 'Redesign foundation: layout and state components'
status: In Progress
assignee: []
created_date: '2026-08-17 11:19'
updated_date: '2026-08-17 13:02'
labels:
  - ux
  - redesign
dependencies:
  - TASK-136
references:
  - docs/brand/prototype.html
documentation:
  - backlog/docs/REDESIGN-PLAN.md
priority: high
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The minimum set under web/components/ that the 13 screens compose from. Full props table in REDESIGN-PLAN.md section 2.2.

PageHeader (13 callers) - h1 plus the German question under it, per section 4.4.
AnswerBand (5) - the number you read first, .answer grid.
ListPanel (~12) - the .list shell with its .lh header; this is what kills the card-in-a-card.
AttentionList (2) - the prototype's .row div-grid, for NON-tabular attention rows only.
StateBadge (4) - the WORD, tinted second.
Field (~11) - label<->control association, required/optional marker, aria-describedby for help and error.
EmptyState (~10) - 'leer heisst: nichts zu tun', not a screen that failed to load.

THE STRUCTURAL CALL, section 0: AttentionList's .row grid is for NON-TABULAR data ONLY. Tabular data stays <table class="data-table"> and gets the prototype's LOOK as CSS, because the <=767px row-to-card transform and components/ResponsiveTableLabels.tsx both depend on it being a real table, and because payroll/pl/analytics need real column and row association. Anyone who ports .row onto a table has broken the phone layout and will not hear about it from a green test.

AttentionList is the thinnest at 2 callers (/ and /shifts/). If /shifts/ ends up not using it, DELETE it and inline the JSX into /. Say so in the review.

NOT built, deliberately: Button, Card, Table, Toolbar, Icon, Tooltip, Toast, useForm. A .btn class is enough. If a screen wants one, that is a note in the task, not a file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/components/ has exactly PageHeader, AnswerBand, ListPanel, AttentionList, StateBadge, Field, EmptyState added; no others
- [ ] #2 Every added component has at least two named callers in REDESIGN-PLAN.md, or an explicit written justification
- [ ] #3 No component renders a bare JSX string literal; every user-visible string arrives as a prop or a message key
- [ ] #4 Field ties <label for> to its control and wires help and error text through aria-describedby
- [ ] #5 StateBadge renders the state WORD; colour is the second signal - a desaturated screenshot of the four states is still readable
- [ ] #6 AttentionList is not used for tabular data anywhere; every table in the app is still a <table class="data-table"> with thead/tbody
- [ ] #7 AnswerBand and every numeric cell use font-variant-numeric: tabular-nums
- [ ] #8 No new npm dependency; package.json unchanged
<!-- AC:END -->
