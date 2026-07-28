---
id: decision-15
title: >-
  NFC tag hostname stays timesheets.exe.xyz for MVP - tags kept unlocked as
  migration insurance
date: '2026-07-28 14:40'
status: accepted
---
## Context

`research/decision-brief.md` flagged the NFC hostname as **the only irreversible choice in
the architecture**. Universal links (iOS) and App Links (Android) require the AASA /
`assetlinks.json` file to be served from the *exact* host in the tag URI. **Redirects are not
followed.** So the host baked into a tag is permanent for that tag's life.

`timesheets.exe.xyz` is a subdomain of the exe.dev platform, not company-owned. Owner
assessed exe.dev as a system he relies on regardless, and judged it good enough for MVP.

## Decision

Write MVP tags against `https://timesheets.exe.xyz/t?...`.

**Mitigation that makes this reversible: leave the NFC tags UNLOCKED** and build an
admin-only tag-writing mode into the iOS app (already scoped as TASK-6). NDEF tags are
rewritable unless explicitly locked. Cheap insurance, ~zero extra work — TASK-6 has to write
tags once anyway; not calling the lock API is the lazy path.

If the host ever moves, a rewrite piggybacks on normal cleaning rounds instead of forcing a
dedicated site visit — workers already enter every building.

## Consequences

**Accepted risk of the unlocked tag:** a worker could physically rewrite a tag to a
different location ID and clock in at building A while standing in building B. Threat model
is low for a 5-20 person company with an audit trail, and it requires physical presence at
the tag being altered. If this ever matters, lock the tags at that point — but by then the
hostname should be settled.

**Why to move to a company-owned domain later** (recorded so the reasoning is not lost):

1. **You do not control the DNS.** If exe.dev changes policy, sunsets the subdomain,
   rebrands, or the owner stops using the platform, every tag dies at once and there is no
   DNS record you can repoint. This is the actual risk — not exe.dev going down.
2. **A domain converts a physical problem into a DNS change.** ~EUR 10/yr for e.g.
   `app.<company>.at` with a CNAME to exe.dev infra. Tags point at a host you own; where it
   resolves is swappable forever. **This is the cheapest possible fix and it stops being
   available the moment tags are glued to walls.**
3. **Client-facing surface.** Building owners and workers see the host when they tap.
   `timesheets.exe.xyz` reads as a side project; `app.<company>.at` reads as a business.
4. **Business asset / handover.** Core infrastructure on a third party's domain is a
   liability in any due diligence, sale, or handover conversation.

**Revisit trigger:** before the first paying client, or before tag count exceeds what can be
rewritten in one cleaning round — whichever comes first. Buying the domain *now* and
CNAME-ing it costs ~EUR 10 and removes the risk entirely; the unlocked-tag mitigation is the
fallback for deferring that.

Supersedes nothing. Constrains TASK-6 (do not lock tags), TASK-8 (URI format).
