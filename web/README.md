# NFC TimeSheets — web admin

Next.js App Router admin panel. **Static export.** Built locally, rsynced to the exe.dev VM,
served by the same Node process that serves the REST API, the AASA file and `/t`
(decision-16). No Vercel, no Cloudflare, no Docker, no server runtime for this app.

This is the **shell only**. Dashboard/Shifts/Workers/Locations/Payroll screens are TASK-15..22.

## Install

Requires Node >= 22 and pnpm 11.

```sh
cd web
pnpm install
cp .env.example .env.local   # then point NEXT_PUBLIC_API_BASE_URL at your local API
```

## Dev

```sh
pnpm dev          # http://localhost:3000
```

In dev, Next serves on :3000 and the API does not, so `NEXT_PUBLIC_API_BASE_URL` must be set.
In production it stays empty and every request is same-origin.

## Verify

```sh
pnpm verify       # check + lint + typecheck + build
```

Individually:

| command          | what it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `pnpm check`     | exact-pin rule (decision-9) + locale key parity (decision-8)         |
| `pnpm lint`      | Biome lint **and** format check — no ESLint, no Prettier (decision-3) |
| `pnpm format`    | Biome autofix                                                        |
| `pnpm typecheck` | `tsc --noEmit`                                                       |
| `pnpm build`     | static export into `out/`                                            |

`pnpm check` is plain Node, no test framework. It enforces the two rules that silently rot:

1. **Every** dependency version is exact. A single `^` fails the build.
2. `messages/de.json` has byte-for-byte the same key set as `messages/en.json`, all values
   non-empty, and every `{placeholder}` preserved across locales.

## Build and deploy to the VM

`pnpm build` writes a self-contained static site to `web/out/`. `trailingSlash: true`, so every
route is a directory with an `index.html` and a dumb file server can resolve it with no rewrite
table.

```sh
pnpm build
rsync -avz --delete out/ timesheets.exe.xyz:/srv/nfc-timesheets/web/
```

The Node API serves that directory as static files, with `/.well-known/apple-app-site-association`,
`/t` and the `/admin/*` + app API routes taking precedence, and unmatched paths falling back to
`web/index.html`. See `server/` and `backlog/docs/runbook-vm-provisioning.md`.

Nothing here is built on the VM — the VM only ever receives the finished `out/` directory.

## Architecture notes

### API layer — `lib/api.ts`

`apiFetch<T>(path, { method, body, signal })`, plus the two calls the shell actually makes:
`login(email, password)` and `logout()`. Every request goes out with `credentials: 'include'`.

Failures always throw `ApiError`, which carries an **i18n message key** (`keyof messages.error`),
never the server's own error body — so a stack trace, SQL error or internal path can never reach
the DOM.

Domain types are deliberately absent: nothing renders shift or worker data yet, and a type
written before its first consumer just drifts from the schema. They arrive with TASK-15..22.

### Auth — `app/login/page.tsx` (decision-20)

There is **no admin PIN**. Sign-in posts `{ email, password }` to `POST /admin/login`; the server
replies with an httpOnly session cookie. The browser stores and attaches it — this bundle never
reads `document.cookie`, never touches `localStorage`/`sessionStorage` for credentials, and keeps
no token in memory after the request resolves.

A rejected credential renders **one** message (`login.failed`) whether the email is unknown or
the password is wrong. Widening that into two messages would turn the form into an account
oracle. Only transport and 5xx faults — which say nothing about the account — render differently.

The form is a real `<form>` with a `<label>` per input, `type="email"` / `type="password"`,
`autocomplete="email"` / `"current-password"`, `aria-invalid` on failure, and an always-present
`role="alert"` region wired to both inputs via `aria-describedby` (always present because a live
region that is inserted on demand announces far less reliably than one whose text changes).
`AppShell` renders `/login/` without nav or the sign-out control.

### i18n — next-intl (decision-17)

next-intl in its **without-i18n-routing** shape, which is the only shape `output: 'export'`
allows: no plugin, no middleware, no `getRequestConfig`, no locale-segmented routes.

- `components/IntlProvider.tsx` imports both dictionaries at build time and hands the active one
  to `NextIntlClientProvider`. It also owns the per-session locale override and keeps
  `<html lang>` correct via `htmlLang()`.
- `app/layout.tsx` needs strings outside React (the `metadata` export) and uses `createTranslator`,
  next-intl's non-hook API. Metadata is baked once at build time, so it always uses
  `DEFAULT_LOCALE`.
- `messages/en.json` is the source of truth; `messages/de.json` currently holds English
  placeholders (decision-8: infrastructure now, translation as a content task).
- Keys are **nested namespaces** (`nav.shifts` = `{"nav": {"shifts": ...}}`) because next-intl
  resolves keys by path. `pnpm check` flattens both files to dotted paths before comparing, so
  key parity is still a plain set difference.
- `MESSAGES` types `de` as `typeof en`, so a *missing* German key is a `pnpm typecheck` error;
  `pnpm check` catches *extra* keys, which the type system allows. The `next-intl` module
  augmentation in `global.d.ts` makes `t('nav.shfits')` a compile error too.
- **No bare user-facing literal belongs in JSX.** Every string goes through `useTranslations()`.
- The active locale default lives in exactly one place: `DEFAULT_LOCALE` in `lib/locale.ts`
  (`NEXT_PUBLIC_DEFAULT_LOCALE` at build time).
- German text runs ~30% longer than English. Nothing in `globals.css` is sized by a fixed pixel
  width; boxes grow with content and labels wrap.

### Desktop-only — `components/DesktopOnlyGuard.tsx`

decision-7: below 1024px the entire admin UI is replaced by a translated blocker. The swap is
CSS (`.desktop-only` / `.mobile-blocker`), not `matchMedia` state — `display: none` also removes
a subtree from the accessibility tree, and a CSS swap has no hydration mismatch and no flash of
the wrong branch. Children still *mount* on a phone; if a screen ever starts an expensive fetch
on mount, gate that screen's data layer with a `matchMedia` hook rather than changing this
component.

### Navigation — `lib/nav.ts`

Every live entry is declared here. `FUTURE_NAV` is the roadmap-stub mechanism — locked items
with a lock icon and a tooltip, `aria-disabled` rather than `disabled` so a keyboard user can
still reach them and learn the items exist — and it is currently **empty**, because the four
that were in it shipped: `/material-requests/`, `/pl/`, `/contracts/` and `/analytics/`.
`SidebarNav` renders the whole "Kommt später" block only when `FUTURE_NAV` has entries; a
heading over an empty list reads as a sidebar that failed to load.

### The four v2 screens

All of them are client components that fetch on mount, exactly like `/workers/`. Each one has
one rule that is not a matter of taste:

- **`/material-requests/`** — the lifecycle move is a single button in the row. `status` is a
  TRANSITION request and the server refuses illegal ones with a 409, so `lib/materials.ts`
  holds a copy of the transition table to decide which buttons to draw; `pnpm check` compares
  that copy against `server/lib/materials.js` rather than trusting it. There is **no push** in
  this system — the worker's app polls — and no copy on the screen may say otherwise.
- **`/pl/`** — `null` from the API is a refusal to guess and is rendered as one. Revenue `null`
  is "no contract on file", never EUR 0. `below_baseline: null` is "cannot be assessed", never a
  pass. The margin baseline (`app_settings.pl_margin_baseline_bp`) ships UNSET and nothing
  defaults it; setting and unsetting it are both controls on the page. A flag is not a red dot:
  every flagged building gets a paragraph naming the margin, the floor, the shortfall and where
  the money went, including the decision-10 hours deliberately left out of the cost.
- **`/contracts/`** — revenue becomes period-correct, labour does not (decision-28). That is a
  permanent on-screen notice, not a release note. Only the CURRENT period can be undone.
- **`/analytics/`** — **no map any more** (decision-39 §2): `/` has the one map in the admin,
  and two maps are two things that can disagree. The table was always the primary
  presentation, so nothing true was lost: the geocode state per building is still a column in
  words, with the three genuinely different reasons, and „erneut geokodieren" is still a row
  action.

### The map — `/`, `lib/map.ts`, `components/HomeMap.tsx` (no npm package)

**The map is the landing surface and the `Objektliste` under it is not optional**
(decision-39). Order on `/`: answer band → map region (may not appear) → Objektliste (always)
→ the ledger, verbatim. Production holds ONE building and its `lat`/`lng` are NULL, so zero
pins is the day-one state, not an edge case — which is why the list is the primary
presentation and the map is a region above it.

Google Maps is loaded with a `<script>` tag and a small structural interface. No
`@googlemaps/js-api-loader`, no `@react-google-maps/api`, no `@types/google.maps`.

**`OverlayView` + an inline `styles` array, and NO cloud `mapId`.** That is a trade-off, not
an oversight: `AdvancedMarkerElement` (the non-deprecated marker) requires a cloud `mapId`,
and a `mapId` makes the API ignore `styles` outright — the muted dark map would silently turn
into a white Google map inside a dark admin. `lib/map.ts` states the upgrade path. `pnpm
check` asserts that no file which constructs a map mentions `mapId`.

**Our own pins, readable without colour.** Glyph + word + weight first, the 3px left rule
second: `● 2 vor Ort` / `○ 0 vor Ort`, with `▲ prüfen` and `▢ kein Tag` as separate boxed
chips. Occupancy and attention are independent — a building can be fully staffed and still
need looking at. Desaturate the screenshot and it must still read;
`docs/media/map-home/grey/` holds the proof.

**Clicking a pin expands an info box ON the pin** carrying the numbers and the cross-links
(the owner's decision, IA-PLAN §9). It is driven by the same `?location=` as the drawer, and
exactly one of the two is ever on screen: the info box when a map is drawn and that building
has coordinates, the `<Drawer>` otherwise. Both render `components/BuildingFacts.tsx`, so
they cannot disagree about a number.

**No Street View on `/`.** Dropped by the owner, not deferred — no image cost, and no
photograph of a customer's front door.

**Cost.** Billing is per `new google.maps.Map`. The map is constructed once per mount and
held in a ref; a data refresh moves pins, a theme switch calls `setOptions`, and there is no
polling on `/`. `demo/check-map-home.mjs` counts constructor calls across a refresh and two
theme switches and requires zero.

**Phone (≤767px).** The map is collapsed behind „Karte anzeigen" and is not constructed at
all until it is asked for — no billed load and no map tiles over a stairwell's mobile data.
Opened, it is 320px with `gestureHandling: 'cooperative'`, so one finger scrolls the page.

`NEXT_PUBLIC_GOOGLE_MAPS_KEY` is a **browser** key, inlined into the bundle at build time and
readable by anyone who opens the panel. That is only safe because it is restricted by HTTP
referrer in the Google Cloud console. The server's `GOOGLE_GEOCODING_KEY` is IP-restricted and
must never be put here.

Seven states, all named on screen in German and none of them a blank rectangle: `noKey` (the
build had no key — a deployment fact, not a fault, and not retryable), `noPins` (nothing is
geocoded yet — the region is **not rendered at all**, because an empty grey frame over a
complete list is a screen apologising for something that is not missing), `loading`, `ready`,
`blocked` (Google rejected the key **or** the quota ran out — the browser cannot tell those
apart and the sentence says so; caught via `gm_authFailure`, which fires LATE, after
`new Map()` has already succeeded, so the region is **torn down** rather than covered),
`failed` (offline, an ad blocker, a proxy) and `timeout` (ten seconds, no `error` event).
Collapsed is the eighth, on a phone, by choice.

`demo/check-map-home.mjs` proves these by breaking things for real: the script blocked at the
network layer, `gm_authFailure` fired, and every coordinate in `nfc_demo` set to NULL. In
every case it asserts the whole portfolio is still listed and the ledger is still under it.

**`ops/backfill-geocode.mjs`** is what gives the map any pins at all: it re-asks Google for
every active building with no coordinates, is idempotent, never overwrites a pin somebody
else set, and fails soft — a missing key or an exhausted quota prints a line and exits 0.

A Street View photograph is requested **only** when `locations.street_view_status === 'OK'`,
i.e. when the metadata endpoint has already confirmed coverage. The static image endpoint
answers HTTP 200 with a grey "no imagery" tile, so an `onError` handler alone ships that tile
and presents it as a photograph of a client's building. `pnpm check` covers the gate.

**Two things the owner has to do, which no code here can do for them:**

1. `ops/deploy.sh` does not pass `NEXT_PUBLIC_GOOGLE_MAPS_KEY` to `pnpm verify`, so a production
   build currently ships with no map. Next does read `web/.env.local` during the deploy build,
   so putting the key there works — but that file is gitignored and per-machine, which makes it
   a deploy that silently depends on who ran it. The durable fix is one line in `ops/deploy.sh`.
2. The **Street View Static API is not enabled** on the operator's Google Cloud project. The
   server's metadata probe answers `REQUEST_DENIED`, so `street_view_status` is never `OK` and
   no photograph renders anywhere. The panel says exactly that, in German, with the reason.
   It starts working the day the box is ticked; nothing here needs to change.

### Accessibility

Landmarks (`banner`, `navigation`, `main`, `contentinfo`), a focus-moving skip link,
`:focus-visible` outlines on everything, `aria-current="page"` on the active nav item, a real
`h1 → h2` outline in `main`, and `<html lang>` driven by the active locale. Nav group labels are
`<p>` + `aria-labelledby` rather than headings so they do not put an `h2` ahead of the page `h1`.

Biome has no "no bare string literal in JSX" rule, so that one is on review, not the linter.
