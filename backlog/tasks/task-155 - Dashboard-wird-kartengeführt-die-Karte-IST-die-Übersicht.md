---
id: TASK-155
title: 'Dashboard wird kartengeführt: die Karte IST die Übersicht'
status: To Do
assignee: []
created_date: '2026-08-17 15:45'
labels:
  - ux
  - web
  - map
dependencies: []
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Iterate the real /  dashboard using the working proof of concept at .poc-map/ (gitignored, 5 files, run: node .poc-map/serve.mjs -> http://127.0.0.1:8080/).

WHAT THE POC ALREADY PROVES (invented data, deterministic seeded PRNG, dark + blue design system): a pin per building carrying a live on-site worker count, click -> side panel with that building's five numbers (on site now, hours this month vs target, last cleaned + who + how long, monthly contract value, margin), a zone list with each tag's last tap, and cross-links out to that building's shifts / payroll / contract. Map as entry point, not a dead end. Street View thumbnail per building. Map styled dark so it does not glare.

DO NOT START until the redesign workflow is finished and reviewed - it owns web/app/page.tsx.

THE HONEST GAP, and it is the whole point: the PoC shows MULTIPLE TAGS PER BUILDING (Eingang, Stiege 1-3, Tiefgarage, Buero 2. OG). The real schema has no such thing - locations has no child table and one building means one tag. That zone/tag model is a migration and a decision record, not a UI change, and it is the expensive half of this idea. The map itself is cheap: lat/lng already exist on locations and geocoding already runs at building creation.

CONSTRAINTS CARRIED FROM THE PROJECT: Google Maps via a plain script tag, no new npm dependency. The browser key is referrer-restricted (schimmer-glanz.exe.xyz, localhost:3000, 127.0.0.1:8080) and must never be written into a file on disk - the PoC's serve.mjs substitutes it at serve time and that pattern should carry over. Must degrade to a plain list when the map fails, when the key is missing or when the quota is spent - a dashboard that goes blank because Google is down is worse than a table. Must work at 390px (decision-28). Colour is the second signal, so pin state must be readable without hue.

Supersedes the separate map page idea in TASK-18 and TASK-48.
<!-- SECTION:DESCRIPTION:END -->
