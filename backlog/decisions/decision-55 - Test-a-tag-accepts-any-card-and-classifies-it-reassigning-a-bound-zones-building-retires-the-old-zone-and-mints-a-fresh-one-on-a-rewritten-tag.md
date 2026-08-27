---
id: decision-55
title: >-
  Test-a-tag accepts any card and classifies it; reassigning a bound zone's
  building retires the old zone and mints a fresh one on a rewritten tag
date: '2026-08-26 20:56'
status: accepted
---

**ACCEPTED 2026-08-26 by the owner**, in real time, in the same conversation that ordered
it.

Amends decision-54 (zone creation/binding lives in the operator app) and decision-47 (a
zone becomes a clock-in target only after an operator test-scans it). Nothing in those
records that this one does not name is touched.

## Context

decision-54 §7 gave Test a tag a zone page, but only for a zone the operator already
PICKED from the worklist (`GET /operator/zones`) before scanning — `POST
/operator/zones/:id/verify` takes the zone id in the URL. There was no way to scan a card
first and ask "what is this", which is the actual shape of the honest mistake decision-47's
own header names as the reason this screen exists: a card found in a drawer, a card on a
door with no worklist entry, a card that used to belong to a since-deleted zone.

Separately, a zone's building is currently permanent once bound. `POST
/operator/zones/:id/bind` refuses (409) a zone that already has one; the only path off a
building is `unbind`, and `unbind` is refused BY THE DATABASE the moment a shift has ever
referenced the zone (migration 013, decision-54 §3). A door that changes management company
— the exact case that motivated decision-40's tagHost/apiHost split for the whole
system — currently has no path at all once a single shift has been tapped there.

## Decision

**1. `GET /operator/tags/:id` — resolve ANY scanned id, no prior selection.** Read-only,
no side effect, checked in this order:

- an ACTIVE zone (bound or not) → `{kind: "zone", zone: {...same shape GET
  /operator/zones/:id already returns...}}` — the client feeds this straight into the
  EXISTING zone-page branch (decision-54 §7: bound shows the building card, unbound shows
  the building picker). No new UI concept, only a new way to arrive at the one that
  exists.
- an ACTIVE building → `{kind: "building"}` — the HOIV-style grandfathered building tag
  (decision-47). Test a tag has no building-level screen and none is added here; this is
  told apart from "unknown" only so the operator hears "that's a building card, not a
  zone" instead of "not ours".
- an INACTIVE zone → `{kind: "retired"}` — the exact card a reassignment (§2) leaves
  behind if it is ever scanned again. A distinct, honest answer beats "not ours" for a
  card that very much used to be ours.
- a `reported_tags` row with no zone yet → `{kind: "tag_reported"}` — written and known,
  nobody has turned it into a zone. No action is offered from this screen; resolving a
  report into a zone stays `POST /operator/tags/:id/resolve-zone`, reached the way it
  always was.
- none of the above → `{kind: "unknown"}` — a stranger's tag, a typo, a torn-off sticker.

Deliberately NOT resolved here: `tag_aliases` (decision-44's adopted-hardware second-tag
mechanism). That id space names an EXISTING zone through a different table and is an admin
concern in practice (the HOIV grandfather is effectively the only occupant); scanning an
alias id through this route answers `unknown` today. Real cost, small blast radius, named
here rather than silently missed.

This is intentionally NOT built on `activePlace`. That function is THE tap path
(`server/lib/validate.js`) and its own header forbids exactly the kind of new branch this
needs — an unbound zone must keep collapsing into `unknown_location` there, because a real
cleaner's tap against a buildingless zone must fail exactly like a tap against nothing. This
route answers a different question ("what IS this card, for a human looking at it") and
earns its own small query rather than bending the one tap resolution has.

**2. Test a tag, scan-first.** The operator scans before picking anything. If the resolved
kind is `zone` and the zone is BOUND, the client also calls the existing `POST
/operator/zones/:id/verify {place_uuid: <same id>}` — unchanged, idempotent, and now reached
without a worklist detour. `zone_mismatch` cannot fire on this path (there is no
pre-selected target to mismatch against); it stays exactly as protective as it always was
for the worklist-first path, which is kept as well — this is an ADDED entry point, not a
replacement.

**3. Reassigning a bound zone's building never moves a live row.** `POST
/operator/zones/:id/reassign-building {new_tag_id, location_id}`, `auth: "operator"`, only
reachable from an already-bound zone's page. It does NOT `UPDATE zones SET location_id`.
Instead, in one statement:

- the OLD zone is retired: `active = false` — the SAME soft-deactivation `DELETE
  /admin/zones/:id` already does today, and the director already reads its own comment as
  "the actual thing... when a tag comes off a wall". Everything about the old zone —
  `verified_at`, every shift that ever named it — is untouched and stays queryable under
  its own id, forever. This is the "closes" in the plain-language ask: no new shift can
  ever reference it (an inactive zone is unresolvable, §1's own `retired` kind is what a
  future scan of the dead card reports), and its existing history does not move, split, or
  get relabelled.
- a brand NEW zone is created, keyed by `new_tag_id` — a fresh id the OPERATOR'S PHONE
  minted and WROTE to the physical card BEFORE this call, exactly the same mint-write-report
  sequence Write a tag already runs (`POST /operator/tags`, unchanged). The new zone carries
  the old one's `name` and `note` forward (same door, same physical description — only the
  building changed) and starts with `verified_at NULL`, 0 shifts: a fresh worklist entry
  that needs its own test scan before it can open a shift, same as any zone born through
  `resolve-zone`.

**Why remint instead of update-in-place, even when the old zone has zero shifts**: one code
path, not two. A zone with shift history structurally CANNOT have its `location_id` changed
in place — `shifts_start_zone_fk`/`shifts_end_zone_fk` are composite FKs on `(zone_id,
location_id)`, so retargeting the referenced row while shifts still name the old pair is
refused by Postgres itself. Special-casing "but if it has no shifts yet, just update it" buys
nothing but a second, less-tested path for the rare zone that gets reassigned before its
first tap, and it would leave that zone with a STALE `tag_deployed_at` and no requirement to
prove the card again in its new context — the same gap bind() already closes by clearing
`verified_at` on every rebind.

**No partial application.** The reported tag is only claimed (`resolved_at` stamped) if the
OLD zone is confirmed live and bound at the same instant, via `EXISTS`-gated CTEs in the one
statement — the old zone is only retired if the new tag was actually claimed. Either both
happen or neither does; there is no reachable state where a door loses its zone without
gaining a replacement, or a freshly-written tag gets silently discarded.

## Consequences

- A reassigned zone's shift history is now split across two zone ids, by design — a report
  spanning the reassignment date has to know this if it ever needs "all shifts at this
  door regardless of which building owned it", which nothing currently computes. Real gap,
  small: the operator app has no reporting surface at all today.
- Reassignment costs a physical revisit: the operator must stand at the door and rewrite
  the card, then test-scan it again before it can open a shift. There is no remote/desk
  path, matching decision-54's own accepted cost for zone creation generally.
- `GET /operator/tags/:id` is a second "what does this id mean" query alongside
  `activePlace`, kept deliberately separate rather than unified — a future maintainer
  extending one must not assume it also changes the other.
