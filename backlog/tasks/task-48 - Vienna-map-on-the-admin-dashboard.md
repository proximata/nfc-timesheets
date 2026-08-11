---
id: TASK-48
title: Vienna map on the admin dashboard
status: To Do
assignee: []
created_date: '2026-08-11 19:12'
labels:
  - web
  - admin
  - maps
dependencies: []
priority: medium
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WANTED: when the admin panel opens, a map of Vienna with the buildings on it.

This was in the original 3A/3B vision (backlog TASK-18, 'Vienna map view with building pins + side panel') and was never built. This task supersedes the framing: the map belongs on the DASHBOARD, the screen that opens first, not on a separate page nobody navigates to.

WHAT EXISTS ALREADY, so this is smaller than it looks:
  - locations.lat/lng are populated server-side at creation by fail-soft geocoding
  - NEXT_PUBLIC_GOOGLE_MAPS_KEY is provisioned and its referrer restriction is already
    retargeted to https://timesheets.exe.xyz/*
  - decision: the map loads via a plain script tag with the browser key. NO new npm
    dependency - that was settled when the v2 screens were built and it stands.

SHAPE:
  - pins for active buildings, click opens the building
  - the dashboard is an EXCEPTIONS screen (open and unresolved shifts) plus recent
    activity. The map must not push that below the fold - a director opening the panel
    needs to see what is wrong before they see a map.
  - a building with NULL lat/lng must not break the map or vanish silently; show it in a
    plain list beside the map so it is visibly un-geocoded and fixable.
  - no key, quota error or network failure may break the dashboard. The map is the FIRST
    thing that fails when a key expires, and it must degrade to the list, not a blank page.
  - desktop-first per decision-7, like the rest of the panel.

HONEST CAVEAT: with one building this is decoration. It earns its place at ten or twenty,
and the reason to build it now is that the geocoding and the key are already in place.
<!-- SECTION:DESCRIPTION:END -->
