---
id: decision-69
title: >-
  Buildings never carry a tag payload: decision-47's HOIV grandfather clause
  retires for real, confirmed unused in the field
date: '2026-08-30 04:57'
status: accepted
---
**IMPLEMENTED 2026-08-30.** `activePlace()`'s building branch is deleted (down to two UNION
arms: zone, tag_alias); `requireVerifiedPlace`'s building early-return is deleted with it,
since a place it sees can no longer carry a null `zone_id`. The web admin's building-level
tag disclosure (`tagLegacySummary`/`tagLegacyHint`) and the `HOIV_BUILDING_ID` pin are
deleted from `web/app/locations/page.tsx`; `web/lib/area.ts`'s `tagResolves` is deleted.
Android's `KnownTags.BY_SERIAL` — the one compiled entry mapping HOIV's adopted-tag serial
to its BUILDING uuid — is emptied, since the owner's confirmation that the card was never
deployed applies to it too. `ops/check-hoiv-survives-006.mjs` and
`ops/check-hoiv-wire-unchanged.mjs`, whose entire purpose was proving the deleted behaviour,
are deleted rather than inverted. decision-47's own grandfather-clause section is struck
(see that record); this decision itself is kept, not deleted, as the citation target for
every site above and the historical record of why the change was safe.

## Context

decision-47 retired minting NEW building-level tags but kept exactly one exception: the
HOIV building's tag, grandfathered by name, still resolves a clock-in tap directly via
`activePlace()`'s building UNION arm with zero zone verification. TASK-251 tracks that
this arm is actually broader than intended — it accepts ANY active building's raw tag
UUID, not just HOIV's — and its planned fix was to narrow the arm to check
`HOIV_BUILDING_ID` specifically, preserving the one grandfathered card.

The owner confirmed (2026-08-30): that card was never actually deployed in the field. The
exception protects nothing.

## Decision

Skip the narrowing step. Delete `activePlace()`'s building UNION arm outright. A building
(`locations` row) never resolves a clock-in tap on its own raw UUID again, grandfathered
or not — only zones do, unconditionally, project-wide. There is no "building tag" field
anywhere in the schema or either mobile client ever again; any UI remnant offering to
show or write a building-level tag URL is removed in the same pass. TASK-251 closes via
this decision rather than via its originally-planned narrower fix.

## Consequences

Closes the real, previously-open gap TASK-251 tracked — completely, not partially: no
building's UUID can ever again be tapped straight into a shift with zero zone
verification. No physical migration step is needed (the usual cost of retiring a
grandfather clause) because the one card this clause ever protected was never issued.
