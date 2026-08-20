# SURFACE PROBE — what a human sees and reaches, re-measured

Adversarial re-test of the surface layer. Everything below was measured this session against a
local stack (`DB nfc_demo`, API on `:8080`, `PUBLIC_DIR=web/out` built WITH the real Maps key)
and against production READ-ONLY. Nothing was written to production, no migration was applied
anywhere, no APK was installed, iOS was not touched.

`backlog/docs/RECON.md` was treated as **evidence to re-test, not findings to repeat**. Two of
its claims did not survive.

---

## 0 · Verdict

```
the grey pin        ✓ OBSERVED, both themes, 1680 + 1440.  RECON H2 is WRONG.
the maps key        ✗ production ships none, AND the key is not authorised for the API host.
                      RECON rank 4 ("one line in deploy.sh") does not work.
layout 11 widths    ✓ 418 measurements, 11 widths × 19 states × 2 themes, +0px worst
the light theme     ⚠ had been measured at ONE width of eleven, pinned by the WRONG
                      localStorage key. 132 silent dark measurements before the fix.
keyboard/overlays   ⚠ 5 of 23 overlays had the full contract. Now 10, and the other 13 are
                      named ceilings instead of silence.
contrast            ✓ computed both themes, 0 unexpected failures, 4 accepted
de/en parity        ✓ 1173 keys, exact; 132 plural nodes; three checks were blind to a
                      plural missing its `one` branch — now four, and it is not
the two hosts       ✓ live, 0 redirects, right types; collapse mutation goes RED twice
android             ✓ core-check 311 assertions OK, known-tags-check 27 OK
```

Six new assertions were added. **Every one was shown RED first, restored, and shown GREEN.**

---

## 1 · The grey pin — RECON H2 overturned

RECON H2: the grey pin "has NEVER been observed", 12 assertions SKIPPED, cause *"the key is
referrer-restricted and rejects `127.0.0.1`"*.

**False, twice.** The key allowlists `http://127.0.0.1:8080/*` — that exact origin and no other
on loopback. And the deeper cause is not permission at all: a build made without
`NEXT_PUBLIC_GOOGLE_MAPS_KEY` has no key to be refused. `README.md` § Checks already said the
port part in as many words.

`BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs`, on a build made with the key:

```
1680/dark   / a pin is grey and SAYS the word, or it is neither
            5 pins drawn · 1 unzoned+pinnable · 1 grey · 1 carrying the word      ok
1680/dark   / the info box hangs off a pin that is grey AND says the word
            306px, grey=true, word=true — Wohnhaus Wagramer Strasse                ok
1680/light · 1440/dark · 1440/light        identical                              ok
                                           224 ok · 0 FAIL · 4 SKIP
```

The 4 remaining skips are both map assertions at **390 only**, and they are principled: the map
is collapsed on a phone by design and the Objektliste IS the surface there — asserted
separately, 2/2 unzoned rows carry the sentence at both themes.

∴ decision-43's *colour is the second signal* is now proven **on the map**. It was provable all
along.

### 1a · Why it had never been observed, and the guard for it

`assertFreshBuild` passes on a keyless bundle. A keyless bundle is not a broken run, it is a
QUIET one — no key → no map → no `.map-pin` → every pin assertion SKIPs or reads zero pins.

And it is one command away at all times: **`pnpm verify` runs `pnpm build` with no key**, because
it is the type/lint gate and has no business knowing about Google. Measured this session:
`pnpm verify` overwrote `web/out` mid-probe and the running probe went blind.

`demo/build-guard.mjs` now exports `assertMapKeyInBuild()`, wired into
`probe-zones-revenue.mjs` and `check-ia-greyscale.mjs`. It throws — a warning in a 600-line log
is a skip with extra steps.

```
RED   (on the keyless bundle pnpm verify had just written)
      Error: build-guard: web/out was built WITHOUT NEXT_PUBLIC_GOOGLE_MAPS_KEY.
             28 chunk(s) scanned, no AIzaSy… in any of them.
GREEN (rebuilt with the key)  check-ia-greyscale: PASS
```

## 2 · The Maps key — the half of B5 that was missing

`node demo/check-map-key.mjs`:

```
FAIL  https://schimmer-glanz.exe.xyz/   apiHost — serves the admin panel
      canvas=0 pins=0 RefererNotAllowedMapError
```

Two facts, and only the first is in RECON:

1. **production ships no key at all.** 13 chunks fetched off the live index, `AIzaSy`
   occurrences: **0**. `ops/deploy.sh` never sets `NEXT_PUBLIC_GOOGLE_MAPS_KEY`.
2. **the key would not work if it did.** The browser key's HTTP-referrer allowlist does not
   contain `https://schimmer-glanz.exe.xyz/*`.

∴ RECON rank 4 — *"Ship the maps key in `ops/deploy.sh`. One line."* — is **wrong as written**.
One line produces a bundle that loads Maps and is refused by Google. Two steps, and the second
is not in this repo:

```
Google Cloud console → APIs & Services → Credentials → the browser key
  → Application restrictions → Websites → add  https://schimmer-glanz.exe.xyz/*
  → KEEP  http://127.0.0.1:8080/*   (every local map check runs against it)
then  ops/deploy.sh: export NEXT_PUBLIC_GOOGLE_MAPS_KEY=…
```

**What the director sees today, therefore, is the no-map rendering** — `<BuildingPanel>`'s
drawer and the Objektliste, not the info box. That is the rendering this probe now audits (§4).

## 3 · Overflow and reachability — 11 widths × 2 themes

`AUDIT_BASE=http://127.0.0.1:8080 node demo/audit-widths.mjs`

```
418 measurements across 11 widths × 19 states × 2 themes.
420/420 passed, 0 FAILED          worst overflow +0px at every width, both themes
self-test: a deliberately 4000px element is DETECTED and NAMED   +2952px div.audit-sabotage
```

767 · 768 · 800 · 900 · 1024 · 1152 · 1280 · 1366 · 1439 · 1440 · 1680, dark and light, over 13
screens plus 6 panel/drawer URL states.

### 3a · The light theme was one width of eleven, and it was pinned by the wrong key

The file measured 11 widths in dark and then light at **1024 only**, reasoning that light is
"the same layout with different paint". That is the same reasoning as "390 and 1680 are fine so
the middle is fine" — which is R1, which is why this file measures eleven widths.

Making it a real pass exposed why it had never been trusted:

```
audit-widths.mjs     localStorage.setItem('ts-theme', …)
probe-zones-revenue  localStorage.setItem('ts-theme', …)
web/lib/theme.ts     THEME_STORAGE_KEY = 'nfcts.theme'          ≠
```

`THEME_INIT_SCRIPT` runs on every load and reads the real key, so the first navigation after
`setTheme` reverted to dark. The first full light pass reported:

```
132 ×  FAIL <width>px light <screen>  — theme did not stick: data-theme=dark
```

That is the run that would have been committed as "418/418 green, both themes" had `measure()`
not read `data-theme` back before trusting it. `probe-zones-revenue` was **masked**: it
re-applies `data-theme` after every `goto`, so its light pass was genuinely light and its
localStorage line was a no-op that looked load-bearing.

Both files now read `THEME_STORAGE_KEY` out of `web/lib/theme.ts` and throw if it is absent —
no literal to drift. Both read the applied theme back. And one assertion states the point:

```
RED    (globals.css: [data-theme="light"] → [data-theme="light-DISABLED"], rebuilt)
       FAIL the light pass is not a second dark pass
            dark rgb(11,12,14)/rgb(233,234,236) vs light rgb(11,12,14)/rgb(233,234,236)
GREEN  (restored, rebuilt)   420/420
```

## 4 · Keyboard — five of twenty-three overlays had ever been opened

`auditOverlay` in `demo/audit-overlays.mjs` is the only place the full contract lives: focus
moves in · `role=dialog` + `aria-modal` + an accessible name · body scroll locked · **Tab
trapped** · **Shift+Tab trapped** · Escape closes · focus back on the opener · scroll released.

It was called on **5** call sites. The tree has **23**. `probe-zones-revenue` covers focus-in /
Escape / restore for three of the missing ones and the TRAP for none of them. So "every drawer
traps focus" was true of five drawers and *unstated* about the rest — and the audit reported
56/56, a number in which the missing ones do not appear.

Added, with the same contract:

| overlay | focusables | result |
|---|---|---|
| `locations:zone` (decision-43/44) | 7 | trapped both ways, focus back on „Zone anlegen" |
| `pl:revenue` (decision-42) | 6 | trapped both ways |
| `home:building-panel` | 8 | trapped both ways |
| `workers:panel` (opened from `?worker=`) | 13 | trapped; lands on `#main-content`, never `<body>` |

`home:building-panel` needs the **unpinned** building: „Öffnen" on a pinned row renders the map
info box instead of the drawer (`BuildingPanel.tsx` says so). The drawer is what production
shows for every building, because production has no map key (§2).

And the **census**, so this cannot recur: overlay call sites are counted off disk and each must
be AUDITED or DEFERRED-with-a-reason, printed on every run.

```
88/88 passed.  23 overlay call sites, 10 under the full contract.
DEFERRED app/locations (2) app/pl (2) app/clients (3) app/contracts (2)
         app/inventory (1) app/material-requests (2) app/analytics (1)
         — NOT COVERED: the trap has never been measured on these

RED    a second <Drawer> added to app/inventory/page.tsx
       FAIL census — app/inventory/page.tsx: 2 on disk, census says 0 audited + 1 deferred
GREEN  restored
```

Also green, unchanged: `audit-overlays2` 25/25, `audit-keyboard` 14/14 (real
`Input.dispatchKeyEvent`, no `.click()`), `probe-focus-restore` GREEN.

## 5 · Contrast, computed — and the greyscale hole

`node demo/audit-contrast.mjs` resolves every token **through Chrome** (`ctx.fillStyle` +
`getImageData`), so the translucent tokens are composited over what is actually behind them.

```
DARK   --text-primary/--bg-base 16.26:1   --text-muted/--bg-base 5.78:1
       --state-unres/--bg-base  ~6:1      --focus/--bg-base 4.64:1
LIGHT  --text-primary/--bg-base 17.77:1   --text-muted/--bg-base 4.94:1
       --state-unres/--bg-base  4.72:1    --accent/--bg-base 4.64:1
0 unexpected contrast failure(s); 4 accepted (the decorative hairline, 1.26:1, REDESIGN-FIX §5)
```

No unscored colour token: the six declared-but-unscored names are aliases (`--state-muted` →
`--text-muted`, `--ink-muted` → `--text-secondary`) or translucent backgrounds, not text.

**The hole was in the greyscale check, not the contrast one.** `check-ia-greyscale.mjs` exists
because colour must be the second signal. Its pin block asserted occupancy and attention and
**never mentioned „ohne Zone"** — the state decision-43 §3 is entirely about. An unzoned
building drawn only in grey passed every line in the file.

```
ok  the map HAS an unzoned building drawn      5 pins, 1 with data-zone=unzoned
ok  every grey pin SAYS its state in a word    1 grey, 1 carrying the word

RED    HomeMap.tsx: `if (false && … zoneState === 'unzoned')`, rebuilt
       FAIL  1 grey pin(s), 0 carrying the word
GREEN  restored, rebuilt
```

### 5a · …and it was failing on a clean tree, for a reason that is not a defect

`demo/seed.sql` creates two auto-closed **unresolved** shifts. `audit-keyboard.mjs` and
`audit-overlays.mjs` drive the correction drawer for real against the same `nfc_demo`, and a
correction RESOLVES them. Run the README's checks in order and this file arrives at 0 unresolved
shifts and reports

```
FAIL  state AUTO-CLOSED names the timer in words
FAIL  a pin that needs attention says so in a word
```

as though the screens had stopped saying it. Measured: the seed's two shifts carried
`corrected_at` timestamps from earlier the same session (`03:17`, `04:43`).

A precondition failure is still a **FAILURE** — a skip is how twelve map assertions read as
passes for a whole run — but it now says which it is and prints the reseed command, and the
fixture is *asserted* up front rather than only printed.

## 6 · The grey pin keeps its word by accident

`HomeMap.tsx` caps a pin at TWO chips and pushes the zone chip **last**:

```
if (unresolved > 0)                flags.push(„prüfen")
if (flags.length < 2 && noTag)     flags.push(„kein Tag")
if (flags.length < 2 && unzoned)   flags.push(„ohne Zone")   ← dropped at 2
```

while the grey comes from `data-zone="unzoned"` unconditionally. A building that earns both
earlier chips is drawn grey with **no word**, and decision-43 §3 fails on that pin.

It cannot happen today, and not by design: `lib/objects.ts` defines `noTag: here.length === 0`
and counts `unresolved` among `here`, so the two earlier chips are **mutually exclusive**.
Nothing stated that, and it is in a file that does not mention pins. **decision-44 is the edit
that ends it** — the day `noTag` means "no zone carries a serial" the two become independent.

`probe-zones-revenue` asserts every grey pin carries the word, but over the demo seed that is
ONE building, and it is one that never earns two chips. So the invariant is now asserted at the
derivation, in `web/scripts/check.mjs`, where the edit has to walk past it.

```
RED    noTag := (zones of this location) === 0
       FAIL  no building earns two pin chips — crowded: „prüfen" and „kein Tag" both fire
GREEN  restored
```

## 7 · de/en parity and Austrian plurals

`cd web && pnpm check` — 1173 keys each, 0 in de only, 0 in en only. ICU parsed with
`@formatjs/icu-messageformat-parser`, resolved out of pnpm's store (the parser next-intl already
formats with, so the check and the runtime agree by construction).

**Three checks and not one of them could see a plural missing its `one` branch.** Argument
parity compares `{count}` to `{count}` and a plural's branches are not arguments; `hasBareCount`
looks for a bare `{count}` and the `#` inside a plural is a pound node. So
`{count, plural, other {# Schichten}}` passes all three and prints „1 Schichten" on the shift
log — the exact wording `check.mjs`'s own header says it exists to prevent, fixed once by
wrapping the sentence in a plural with nothing asserting the wrapping was complete.

```
RED    deleted the `one` branch from home.toDoUnresolved in de.json

       key set identical to en.json                 ok    ← blind
       ICU arguments preserved (plurals included)    ok    ← blind
       every tallied {count} selects a plural form   ok    ← blind
       every plural has a one AND an other branch    FAIL  home.toDoUnresolved (has: other)

GREEN  restored. 132 plural nodes across both locales, all with one + other.
```

German and English are both two-form CLDR languages; Austrian German differs from `de` in
vocabulary and formatting, not in plural rules. `=0` / `=1` are exact-value branches — extra,
never a substitute.

## 8 · The two hosts

Live, read-only:

```
https://timesheets.exe.xyz/.well-known/apple-app-site-association  200 application/json  0 hops
https://timesheets.exe.xyz/.well-known/assetlinks.json             200 application/json  0 hops
https://timesheets.exe.xyz/t?l=<uuid>                              200 text/html         0 hops
server/wellknown/verify.sh → VERIFY OK    node ops/check-branding.mjs → OK (14 assertions)
android: TagLink(BuildConfig.TAG_HOST, LEGACY_TAG_HOSTS)   Api.kt base = https://API_HOST
```

**Mutation-tested three ways. All RED.**

| mutation | caught by |
|---|---|
| `ops/branding.json`: `apiHost := tagHost` | `check-branding` — 3 FAILED |
| `android/branding.properties`: `ts.apiHost := tagHost` (the live B2 bug) | `check-branding` — 1 FAILED |
| `AndroidManifest.xml`: `${apiHost}` into the `autoVerify` filter | `check-branding` **and** `core-check` |

The third is the one that matters — App Link verification is all-or-nothing across the hosts in
a filter, so a renameable host in there kills the tags that currently work. Two independent
checks catch it.

⚠ `check-branding` reports a standing TODO, correctly: **iOS is still associated with the
RENAMEABLE host** `schimmer-glanz.exe.xyz`, not the permanent tag host. Universal links work
today only because the API host also serves the association files. Out of scope here; it is an
Xcode build.

## 9 · Android

`cd android && ./checks/run.sh` — **there IS a runner**, and the brief's "there is no runner"
is out of date. It compiles the pure `core/` on a plain JVM, no Gradle, no SDK, no device.

```
core-check: OK          311 assertions
known-tags-check: OK     27 assertions
```

### 9a · The cross-platform corpus does not exist

`ops/workflows/w2` calls "the cross-platform TagLink corpus" a standing battery. **There is no
such artefact.** What exists is two independently written case lists and a comment:

```
android/checks/core-check.kt          14 reject cases + a legacy-host set
NFCTimeSheets/checks/tag-link-check.swift   8 reject cases
core-check.kt:141  // Verified against Swift: cat NFCTimeSheets/{Branding,TagLink,API}.swift
```

Measured: Kotlin's 14 are a strict **superset** of Swift's 8, and the extra six are the
security-relevant ones — `https://host@evil.example.com`, `https://evil-host`,
`https://host.evil.example.com`, the lenient-parser uuid `1-1-1-1-1`, and leading/trailing `+`.
So the two agree today, by hand, and nothing would notice if they stopped.

⚠ And they already disagree about one thing: `tag-link-check.swift` hardcodes
`schimmer-glanz.exe.xyz` as the tag host — the pre-decision-40 single-host model. Consistent
with the iOS TODO in §8. **Not fixed: iOS is out of scope.**

---

## 10 · What I could NOT test — as loudly as what I did

- **No physical Android device.** `adb devices` was not consulted. Every Android claim here is
  about bytes and logic, never about a tap. `verify.sh` says so itself: `pm get-app-links` must
  report `timesheets.exe.xyz: verified` and that is unproven off-device.
- **No APK was built or installed.** RECON's B1/B2 — the field phone cannot clock in — was not
  re-measured and is not in this document's verdict.
- **iOS untouched.** `NFCTimeSheets/` was read (two files) and not modified. The two iOS
  findings in §8 and §9a are reported, not fixed.
- **The grey pin at 390px remains unobserved** and is stated as a principled skip, not a pass.
  The map is collapsed on a phone by design; the Objektliste is the surface and IS asserted.
- **13 of 23 overlays still have no trap measurement.** They are named ceilings in the census,
  not silence, and that is the whole of the improvement — the trap on `/clients/`,
  `/contracts/`, `/inventory/`, `/material-requests/`, `/analytics/` and the two `/locations/`
  confirms has still never been measured.
- **Production was read only.** `curl` on the index and 13 chunks, `curl` on both association
  files and `/t`. No SSH, no `psql`, no write, no deploy, no migration.
- **No claim about whether decisions 41–44 should be accepted.** They are still `proposed`;
  decision-43 supersedes the `accepted` decision-37 and that contradiction is untouched, per
  brief. Code that depends on it: `web/lib/objects.ts` `zoneStateOf`, `HomeMap.tsx`'s
  `data-zone`, `check.mjs` §8c/§8d, migration 006's `zones` table.
- **`demo/fix-mutants.sh t176` was not re-run** — RECON B4 says it is dead. Not re-measured.
- **Contrast was not re-mutated.** `audit-contrast.mjs` gained no new assertion this session, so
  its existing numbers are reported as read, and its own mutation recipe (lighten
  `--text-muted`) was not executed.

## 11 · Ranked, by what hurts

1. **Authorise the Maps key for `https://schimmer-glanz.exe.xyz/*` in the Google console, THEN
   set it in `ops/deploy.sh`.** §2. One of those steps is not in this repo and doing only the
   other ships a map that Google refuses. `demo/check-map-key.mjs` is the gate and is RED now.
2. **Decide 41–44 in writing.** Unchanged from RECON rank 2. §6 is a new, concrete dependency:
   decision-44's `noTag` redefinition silently breaks decision-43 §3 on the map.
3. **Measure the focus trap on the remaining 13 overlays.** §4. The census names them; the work
   is mechanical and each one is a keyboard user stuck inside a screen.
4. **Move `check-ia-greyscale.mjs` before the writing audits in the README's order, or reseed
   between them.** §5a. Today the documented order makes it fail for a reason that is not a
   defect, which is how a suite gets ignored.
5. **Give the TagLink corpus one home.** §9a. Two hand-maintained lists that happen to agree,
   one of which still names the wrong host.
