---
id: TASK-30
title: Cryptographic proof-of-physical-presence for NFC clock-in
status: To Do
assignee: []
created_date: '2026-07-28 16:00'
labels: []
dependencies: []
priority: low
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FUTURE / RESEARCH - do not build in 3A or 3B without explicit go-ahead.

PROBLEM: a static tag payload (slug or UUID) proves only that someone KNOWS the value, not that
they are standing at the tag. A worker who reads a tag once can replay that URL from home forever.
decision-15 leaves tags unlocked, so the value is also copyable by anyone who visits the building.

IDEA (owner's, 2026-07-28): rotate the tag payload so the backend can verify the presented value
belongs to the currently-valid subset for that location, rather than being any historical value.

DIRECTIONS WORTH RESEARCHING (none chosen):
- NFC tags with genuine crypto: NTAG 424 DNA / NTAG 413 support SUN (Secure Unique NFC) - the tag
  itself computes a per-tap AES-CMAC over an incrementing counter. Backend verifies MAC + counter
  monotonicity. This is the real answer and needs no rewriting; it needs different HARDWARE.
  Cost per tag is higher than plain NTAG213. Evaluate first.
- Rotating payload written by an admin device on a schedule - works with cheap tags but needs
  someone physically revisiting every building on every rotation. Almost certainly not worth it.
- HMAC(location_secret, time_window) written to the tag - same revisit problem.
- Secondary signal instead of tag crypto: phone GPS at punch time cross-checked against the
  building coordinates we already store (lat/lng from Geocoding). Weaker, spoofable on a rooted
  device, but effectively free and catches casual abuse.

EVALUATE AGAINST: 5-20 workers, small company, audit trail exists, and the threat is a worker
inflating hours - not an external attacker. The cheapest adequate control probably wins.

Prerequisite before ANY of this: decide whether tag tampering has actually occurred. Do not build
a cryptographic control for a threat that never materialises.
<!-- SECTION:DESCRIPTION:END -->
