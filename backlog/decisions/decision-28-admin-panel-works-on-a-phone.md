---
id: decision-28
title: The admin panel works on a phone (supersedes decision-7)
status: accepted
date: 2026-08-12
supersedes: decision-7
---

## Context

decision-7 made the admin panel **desktop-first with an explicit mobile blocker**: below
1024px the entire UI was replaced by a card reading *"Für den Computer gemacht"*.

That was a defensible decision and it was not laziness. The reasoning was: payroll tables,
month-long shift lists and the P&L screen are dense, comparative, numeric screens; a
director approving hours before paying people should be at a desk; and a screen that
technically renders but cannot be used is worse than an honest instruction to find a laptop.

What changed is the observed reality of who uses it and where. The director is in buildings,
not at a desk. The events that actually need the panel are field events: a worker cannot
clock out and the shift must be closed by hand; a new cleaner is standing there and needs an
invite; a tag is dead and someone needs to check whether the shift landed. Every one of
those happened in the first fortnight of real use, and every one of them happened away from
a computer.

The blocker turned "open the panel and fix it" into "go home and fix it". A panel you cannot
reach when the problem occurs is not desktop-first, it is unavailable.

## Decision

The admin panel works on a phone. The mobile blocker is removed and `DesktopOnlyGuard` is
deleted.

**This is not a promise that every screen is equally good on a phone**, and pretending
otherwise is how the failure decision-7 feared actually arrives. Per screen:

| Screen | On a phone |
|---|---|
| Dashboard | **First class.** The exceptions view is the most valuable thing to see in a building. |
| Shifts, Payroll, Material requests, Contracts, Clients, Inventory, Workers, Locations | **Cards, not tables.** Each row becomes a labelled card. Tables do not shrink; they are replaced. |
| P&L, Analytics | **Usable, honestly cramped.** Dense comparative screens. They render and scroll rather than being blocked, and are still better on a large screen. |
| Client portal | **Unchanged.** It was already exempt from decision-7 and already built for 320px. |

The breakpoint is 768px. Above it nothing changes at all — the desktop layout that exists
today is untouched, which is what keeps this cheap and keeps the risk one-sided.

## How

The row-to-card transform is **CSS on the one shared `.data-table` class**, so it applies to
all eleven screens at once and to any screen added later without anyone remembering to opt
in. Cell labels come from `<thead>` at runtime (`components/ResponsiveTableLabels.tsx`,
about fifteen lines) rather than from `data-label` attributes hand-added to several hundred
`<td>`s across eleven files.

Ceiling, stated honestly: **the labels need JavaScript.** With JS off, a card shows its
values without their headings. The panel already requires JS for every fetch it makes, so
this adds no new dependency — but it is a real ceiling and the upgrade path is server-
rendered `data-label` attributes if that ever stops being true.

## Consequences

- The strongest argument of decision-7 survives and must keep being honoured: **a wide table
  of numbers on a narrow screen is not usable.** Hence cards. Any future screen that answers
  this with a horizontal scrollbar has missed the point of this record.
- Payroll's reconciliation line and its named exclusions must stay visible on a phone. They
  are the reason the number can be trusted, and they are the first thing a responsive
  layout is tempted to hide.
- Touch targets of at least 44px, and no affordance that exists only on hover — a phone has
  no hover, so a hover-only control is an invisible control.
- The `desktopOnly` message keys are removed from both locales, in step, to keep parity.

## Revisit if

Someone starts doing month-end payroll on a phone and gets it wrong. That is the scenario
decision-7 was really protecting against, and if it happens the answer is not to restore the
blocker but to make that one screen refuse to do the dangerous thing on a small screen.
