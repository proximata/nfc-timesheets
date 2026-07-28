---
id: decision-5
title: NFC location ID encoded in NDEF URI (not hardware UID)
date: '2026-07-28 13:51'
status: accepted
---
## Context

Background NFC tag reading (Path C) delivers the NDEF payload (URL) to the app, NOT the hardware UID. Current app logic uses hardware UIDs to identify locations. These are incompatible.

## Decision

Encode location ID in the NDEF URI: `https://timesheets.exe.xyz/t?l=<LOCATION_UUID>`. Each tag gets a unique URI written once. App parses the URL query param on launch. Hardware UID no longer needed for location identification.

## Consequences

- Tags must be rewritten with location-specific URIs (one-time, using NFC Tools)
- If a tag is replaced, just write the same URI to the new tag — location ID is in the URL, not the hardware
- Existing hardware-UID-based location registration in admin panel needs updating
- Simpler model: location = UUID in DB, tag carries that UUID in its URL
