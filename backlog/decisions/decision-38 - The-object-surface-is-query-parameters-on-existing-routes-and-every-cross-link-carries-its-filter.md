---
id: decision-38
title: >-
  The object surface is query parameters on existing routes and every cross-link
  carries its filter
date: '2026-08-18 03:15'
status: accepted
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full plan: `backlog/docs/IA-PLAN.md`. Journey map it falls out of: `backlog/docs/JOURNEYS.md`
(§6 lists the nine exact places the thread snaps). Relates to: decision-16 (everything
server-side on one VM, static export), decision-21 (UUID in the tag URI, never the slug),
decision-28 (the admin works on a phone). **Supersedes nothing.**

## Context

Measured against the commit before the redesign, the admin has **14 screens, 12 flat nav
destinations and 2 cross-links, none of which passes a filter**. One screen per database
table; the director assembles every journey in their own head. `/workers/` does not link to
that worker's shifts, `/locations/` does not link to that building's payroll, `/shifts/` does
not link back to the worker.

`web/app/` has **no dynamic route segment anywhere**: there is no `/workers/<id>` and no
`/locations/<id>`. `/shifts/` accepts exactly one URL parameter, `?period=`, read from
`window.location.search` (not `useSearchParams`) so the static export keeps working.

Both of the two nouns every ranked journey names — a building and a worker — therefore have
no surface of their own. D5 („I could not clock out", rank 3), D14 („my hours are wrong") and
D8 („is this building worth it", rank 14) all begin by naming an object and then re-finding it
by hand in a second table.

The admin is a **static Next.js export served by the same Node process** (decision-16). A
dynamic segment needs either a server render — a different architecture — or a pre-generated
page per row, and rows are created daily.

## Decision

1. **The object surface is a query parameter on an existing route, not a new route.**
   - a building: `/?location=<uuid>` opens the Objektpanel on the home screen
   - a worker: `/workers/?worker=<uuid>` opens the Mitarbeiterpanel
   - **no dynamic route segment is added**, and no route is renamed or deleted

2. **One parameter vocabulary, used identically on every screen:**

   ```
   location=<uuid>  worker=<uuid>  client=<uuid>  shift=<uuid>
   period=  all | thisMonth | lastMonth | last30Days | last7Days   ← the literal ids in lib/period.ts
   state=   open | unresolved | manual | noEmail | noTag
   status=  open | decide | order | deliver                        ← materials only
   open=<uuid>      opens the edit drawer on /locations/
   ```

3. **Every cross-link carries the state that produced it**, and three rules make that honest:
   - a link is **never rendered to an empty target**; the cell states the zero in words
   - the **label states the filter before the click** („Schichten dieses Objekts · November")
   - the **target echoes the filter as a removable chip** (`Objekt: Arsenalstraße ✕`)

4. **A screen ignores every parameter it does not understand** — silently. Never a 404, never
   an error, never a blank screen.

5. **URL parameters seed client-side filter state. They never become a server query.**
   `/shifts/` fetches an unbounded snapshot on purpose: it has to be able to say „nothing in
   August — 5 shifts exist in earlier periods", and a server-bounded fetch can only count what
   it holds.

## Consequences

- All nine gaps in `JOURNEYS.md` §6 close. Six of them (1, 3, 5, 6, 7, 9) close from the
  parameter contract **alone**, before any panel exists — which is why it is the first
  shippable step in `IA-PLAN.md` §5.
- `/payroll/`'s three links stop landing in a different period than their source. The
  `period=` value must be the literal id from `lib/period.ts` or the defect returns.
- **A filtered screen must never read as an empty database.** Rule 3 is not decoration: it is
  the same failure `home.recentScope` exists to prevent, and `/shifts/`'s existing
  `emptyOutside` / `latestRecorded` escape must be extended, not replaced.
- **Accepted ceiling:** the URL says `/workers/?worker=…`, not `/workers/<id>`. It is uglier,
  it does not nest, and a shared link carries a UUID in a query string. Upgrade path:
  `generateStaticParams`, or a server render, if the export ever gains one. Not built now.
- **Accepted ceiling:** two panels only. There is no client panel, no contract panel and no
  material panel, because no ranked journey starts with those nouns.
- The parameter vocabulary lands on all six screens in one step or on none. Half of it — one
  screen reading `?loc=` while another reads `?location=` — is worse than none.
