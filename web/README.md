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

Live entries and the four v2 roadmap stubs (Material Requests, P&L Dashboard, Contract
Management, Building Analytics) are declared here. Stubs render with a lock icon and a tooltip;
they use `aria-disabled` rather than `disabled` so a keyboard user can still reach them and
learn the items exist, and the tooltip text is also exposed via `aria-describedby`. No pages
exist behind them and none should be created here.

### Accessibility

Landmarks (`banner`, `navigation`, `main`, `contentinfo`), a focus-moving skip link,
`:focus-visible` outlines on everything, `aria-current="page"` on the active nav item, a real
`h1 → h2` outline in `main`, and `<html lang>` driven by the active locale. Nav group labels are
`<p>` + `aria-labelledby` rather than headings so they do not put an `h2` ahead of the page `h1`.

Biome has no "no bare string literal in JSX" rule, so that one is on review, not the linter.
