---
id: TASK-255
title: >-
  The /tags/ screen — the one control that turns a mounted card into a working
  zone — is a raw HTML table with no i18n
status: Done
assignee: []
created_date: '2026-08-24 19:05'
updated_date: '2026-08-24 19:36'
labels:
  - web
  - ux
  - zones
  - i18n
dependencies: []
priority: high
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, step 'Reach /tags/ (Unzugeordnete Tags) and resolve the reported tag into a new zone Haupteingang on the new building'. Driven live against a local demo stack with the current web/out build.

WHAT THE OWNER SEES: /tags/ is the ONLY admin control that turns a card an operator wrote and reported in the field into a zone a cleaner can clock in on. It is the exact step a real owner performs when onboarding a new building. It renders as a plain bordered HTML table with default OS-styled radios and selects, dropped into an otherwise fully designed dark-themed product.

CONFIRMED AT HEAD, not inferred: web/app/tags/page.tsx has ZERO occurrences of useTranslations (grep count 0). Its own file header says it is 'DELIBERATELY THE PLAINEST POSSIBLE SCREEN, not the house style used everywhere else in this bundle (no PageHeader, no ListPanel, no Drawer, no next-intl)' and names /workers/, /operators/ and /locations/ as the reference for the polished version. It is also not in lib/nav.ts — reached only by URL or the link on the /locations/ header.

So this screen carries TWO defects at once, and they are the same fix: it is unstyled, and every one of its strings is a hardcoded German literal (RESOLVE_ERROR_SENTENCES, the radio labels, the column headings). That is the exact failure mode the project AGENTS.md i18n section names by file: 'this is exactly how web/app/tags/page.tsx shipped German-only with zero i18n, found 2026-08-24'.

The functional flow itself is CORRECT and must not regress: the tag appears with reporter name and timestamp and a 6-char token matching the operator-phone convention, resolving produces a clear confirmation sentence naming the new zone, and the list empties. Every RESOLVE_ERROR_SENTENCES entry says what to DO rather than printing the server code — that mapping is right, it just belongs in the message catalogue.

decision-47 constraint that must survive verbatim: 'Neues Gebaeude' is GONE and POST /admin/tags/:id/resolve-building is deleted. The sentence under the radios that explains a new building is created tag-free under Objekte, and the card then becomes its FIRST zone, must still be on the screen after the restyle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The screen uses the same PageHeader / ListPanel / Drawer primitives as /workers/, /operators/ and /locations/ — no raw bordered table, no default OS-styled radios or selects
- [x] #2 web/app/tags/page.tsx goes through useTranslations for every user-visible string; a grep for useTranslations in that file returns a non-zero count
- [x] #3 Every RESOLVE_ERROR_SENTENCES entry moves to de.json and en.json with exact key parity, and still says what to DO rather than printing the server code
- [x] #4 The reporter name, the report timestamp in Europe/Vienna, and the 6-char token stay on the row — nothing true is dropped to lighten the screen
- [x] #5 The sentence explaining that a new building is created tag-free under Objekte and the card then becomes its first zone survives verbatim (decision-47)
- [x] #6 The screen earns its place in lib/nav.ts, or the task records the deliberate decision that it stays URL-only
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 19:36
---
VERIFIED independently at 08b30f7 (not from the build agent's claims).
AC1 ✓ PageHeader/ListPanel/Drawer/Field/EmptyState imported and used; table is class=data-table, the same primitive /workers/ (line 905) and /operators/ (line 450) use, styled by globals.css and turned into cards <=1279px by components/ResponsiveTableLabels.tsx; radios gone, every select sits inside <Field> so .field select (globals.css:552) styles it — no OS default left.
AC2 ✓ grep -c useTranslations app/tags/page.tsx = 3 (import + t('tags') + tError('error')); was 0. No bare JSX literal remains.
AC3 ✓ all 8 RESOLVE_ERROR_SENTENCES entries plus the 'Abgelehnt vom Server' fallback are in de.json/en.json as errorInvalidField..errorRejected, German text byte-identical to the old literals, still says what to DO, never the code (RESOLVE_ERROR_KEYS maps code -> key).
AC4 ✓ row keeps full 36-char id + 'Token: {last6}' + reported_at via format.dateTime with BUSINESS_TIME_ZONE='Europe/Vienna' + reported_by_operator_name (fallback '(unbekannt)').
AC5 ✓ decision-47 sentence survives verbatim as tags.buildingNote: 'Ein NEUES Gebaeude wird zuerst unter <locationsLink>Objekte</locationsLink> angelegt — ohne Tag. Danach kann dieser Tag hier als erste Zone darin zugeordnet werden.' — same words as the pre-rewrite <p>, now via t.rich with a live /locations/ link. NOTE: it now renders inside the Drawer instead of inline in the row, i.e. one click deeper; same conditional depth as the old per-row form, judged parity not regression.
AC6 ✓ deliberate: stays URL-only. /tags/ is in OFF_NAV_ROUTES (lib/nav.ts:100) with its way in documented, and /locations/ line 1221 renders the link (TAGS_PATH). check.mjs reachability guard passes non-vacuously. Recording that decision here satisfies the 'or' branch.
i18n parity: independent key-set diff — de 1337 keys, en 1337, zero one-sided; new tags namespace is real Austrian German, not English copy-paste (only 3 identical values in the namespace, all legitimately identical: 'Tag', 'Zone', 'Token: {token}').
Gates re-run by me: tsc --noEmit exit 0, biome check clean, node scripts/check.mjs all passed, pnpm build succeeded with /tags in the static route list.
---
<!-- COMMENTS:END -->
