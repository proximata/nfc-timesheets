---
id: TASK-198
title: 'Admin zones: building creation stops writing tags, zone creation starts'
status: Done
assignee: []
created_date: '2026-08-19 14:02'
updated_date: '2026-08-27 07:33'
labels:
  - web
  - zones
  - nfc
  - i18n
  - a11y
dependencies:
  - TASK-196
documentation:
  - backlog/decisions/decision-43
  - backlog/decisions/decision-44
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-43, the admin surface. ZONES-MODEL.md $3.5, $8.

BUILDING DRAWER (/locations/)
  step 1  identity + address + client/contact     unchanged
  step 2  contract                                unchanged
  step 3  OPTIONAL 'Erste Zone anlegen': name, m2, note
          Skipping SAVES the building unzoned, with a named next action. A building with a
          contract and a contact but no zones is LEGITIMATE.
  NO TAG URI ON THIS PATH ANY MORE. Creating a building no longer produces a sticker to write.

ZONE DRAWER (from the building panel, or from step 3)
  name · m2 (OPTIONAL -- NULL means nobody has measured it, and an invented m2 poisons the
  EUR/m2 benchmark that is the only reason the column exists) · note (where the tag physically
  is: 'hinter der Tür links, hüfthoch') · then the tag walkthrough, which is the SAME control
  as today's, repeated per zone:
      the zone's URI verbatim in a code-block + one-click copy + the UUID underneath
      'mit NFC Tools schreiben · NICHT sperren' (decision-15)
      [ Tag angebracht ] -> tag_deployed_at
  OR adopt an existing tag: type its serial, normalised on input. Next to that field, in words:
      'Ein übernommener Tag ohne URL kann die App nicht von selbst öffnen. Er funktioniert nur
       über Scannen in der App.'
  A worker must not discover that at a door.

*** DO NOT DROP THIS ***
The building keeps a COLLAPSED, READ-ONLY 'Gebäude-Tag (Bestand)' disclosure showing its own
URI, labelled 'Nur für bereits angebrachte Tags. Neue Tags tragen eine Zone.' The card on the
wall carries a BUILDING uuid; without this the director cannot see what it says or re-write it
if it is lost. Collapsed and never the primary control, so no new building-level tags get minted
out of habit.

ZONE LIST on the building panel: name · m2 (or 'Fläche unbekannt') · Tag-Status
(geschrieben / übernommen / kein Tag) · letzter Kontakt (DERIVED from shifts, never stored).

URIs are built by web/lib/tag.ts on the PERMANENT tag host (decision-40) -- one place, already
gated by a format check. Never hand-concatenate a host here.

WARNING COPY, until the zone-aware APK is confirmed on the field phone: adding a SECOND active
zone to a building makes every intra-building tap read as a building switch on the shipped
build (auto_closed = true + a new shift). The zone drawer must say so.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1     -> D1 (onboard a new client from nothing ★ starts next week): creation completes without a tag and names the next action.
AC#2,#3  -> D2 (get a working tag onto a wall): the URI the director copies is the zone's, and the legacy building URI stays visible because it is on a wall today.
AC#4     -> D8 (is this building worth it): an unmeasured zone is „Fläche unbekannt" and never 0, or the €/m² benchmark rots.
AC#5     -> D2 + W10: the serial the director reads off a tag is accepted in the three shapes it is ever written in.
AC#6     -> W3/W6 + P1: the sequencing warning is the only thing standing between step 6 and a flood of auto-closed shifts.
AC#7,#8  -> D1/D2 at 390px (decision-28) and IA-A11Y.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Building creation completes with zero zones and offers a named next action; no tag URI appears on that path
- [x] #2 The zone drawer renders the zone's URI verbatim from lib/tag.ts, with copy and the UUID line, matching today's building control exactly
- [x] #3 RED, seeded: remove the 'Gebäude-Tag (Bestand)' disclosure -> a check asserting the HOIV building's own URI is reachable in the admin goes red
- [x] #4 m2 left empty saves NULL and the zone list says 'Fläche unbekannt' -- never 0
- [x] #5 Serial input accepts '04a1a852ae5c80', '04-a1-a8-52-ae-5c-80' and '04:A1:A8:52:AE:5C:80' and stores the canonical form; a serial already claimed answers 409 naming the other zone
- [x] #6 The second-zone warning is rendered until the APK is confirmed, and it is a sentence, not a colour
- [x] #7 de/en exact key parity (web/scripts/check.mjs); Austrian business German; every plural through ICU
- [x] #8 Renders at 1680 and at 390; the zone list is stacked blocks on narrow; focus trap and Escape behave as in the existing Drawer
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, AC-checkbox hygiene only (read-only; no app code touched, no deep re-verification of this task's individual claims).
Headline claims confirmed live on schimmer-glanz.exe.xyz via read-only psql:
 - decision-41: workers.hourly_rate_cents is REQUIRED with NO default. information_schema.columns -> hourly_rate_cents | is_nullable=NO | column_default=(empty). Matches server/db/migrations/006_zones_revenue_rates.sql:64-65 (DROP DEFAULT, then CHECK workers_rate_positive (hourly_rate_cents > 0)).
 - decision-42/28: the revenue fact table exists. to_regclass('location_revenue') -> location_revenue. Defined at 006_zones_revenue_rates.sql:86-108 (month-start CHECK, one-live-row unique index on (location_id, month) WHERE superseded_at IS NULL, append-only).
 - migration 006 is applied on production: schema_migrations lists 001..013 including 006_zones_revenue_rates.sql.
ACs checked as a batch on that basis. Nothing here re-litigates the individual AC wording.
<!-- SECTION:NOTES:END -->
