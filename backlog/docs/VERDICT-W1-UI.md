# VERDICT-W1-UI — what a human sees on /operators/, driven rather than read

Scope: the `/operators/` screen (TASK-214) and everything W1 touched in `web/`. Measured this
session on this laptop, against `nfc_demo` and a keyed build of `web/out` served by the API on
`127.0.0.1:8080`.

**Production was neither read nor written. No deploy, no migration, no SSH. No file under
`web/`, `server/`, `android/` or `NFCTimeSheets/` was changed by this run** — every commit is
in `demo/` and `backlog/`.

---

## 0 · Verdict

```
the screen itself          ✓ create · list · code · revoke · deactivate all work, 1680 + 390,
                              dark + light, keyboard-only, and the phone collision is a real
                              error the director can act on
the ONE product defect     ✗ nothing on the screen ever says an operator's phone cannot be a
                              worker's — TASK-215, and the obvious fix is invisible where it
                              matters (§2)
the checks guarding it     ⚠ three holes, all in MY area, all closed this round: two audits
                              had never loaded the screen, and one could not see a button
the probe itself           ⚠ three fabricated defects, found by disagreeing with a screenshot
                              and fixed before anything was believed (§4)
decisions 41…44            — untouched. Still PROPOSED, 43 still supersedes the ACCEPTED 37
```

51 assertions on `/operators/` (50 green, 1 named gap) + 9 on the worker form, each one shown
RED by a mutant that removes exactly the property it claims.

---

## 1 · What was actually driven

`node demo/check-operators.mjs` — logs in, and then does what a director does:

| journey | evidence |
|---|---|
| the list | 3 seeded operators, **1680 + 390 × dark + light**, names read back off the DOM |
| create | `PROBE Operator` + `0664 900 90 01` → row appears carrying `+436649009001` |
| the E.164 preview | the drawer showed „Wird gespeichert als: +436649009001" *before* saving |
| collision | worker Anna Berger's claimed `+436600000004` → refused, drawer open, values kept |
| enrolment code | `2EHH-9S6V` shown once, focus lands on the panel, hash in the DB, plaintext not |
| revoke | confirmation names the person → row falls back to „Kein Zugangscode", hash gone |
| deactivate | confirmation names the person and admits it is final → „Inaktiv", soft delete |
| keyboard | both overlays: focus in, trapped both ways, Escape closes, focus back on the opener |
| widths | 767 · 768 · 800 · 900 · 1024 · 1152 · 1280 · 1366 · 1439 · 1440 · 1680, **× 2 themes, list AND drawer open** — 0 overflow |
| 390 / 360 | `audit-phone` 28/28: no sideways scroll, card captions match their columns, tap targets |
| contrast | 55 visible strings, **both themes**, computed on the real DOM: worst 4.93:1 dark, 4.60:1 light |
| greyscale | status and code state are WORDS on every row; contrast survives the luma matrix |
| **the same write journey at 390px**  | create → code (whole, `scrollWidth 390`) → revoke through its confirmation → deactivate through its confirmation → the row says „Inaktiv" |
| teardown | `operators 3→3 · identities 4→4 · codes 0→0`, asserted, not assumed |

`node demo/check-worker-form.mjs` — the wage, because the brief asks and because decision-41 is
still PROPOSED:

```
Name: *  ·  E-Mail-Adresse: optional  ·  Telefonnummer: optional  ·  Stundensatz: *
      (not asked about: the „Aktiv" checkbox — a checkbox is never empty)
* and the native `required` agree, field by field
the hint says „Pflichtfeld und größer als null" AND that 0,00 € is a missing wage, not an agreed one
an empty wage → aria-invalid on the field, drawer stays open, 7 workers before and after
/workers/ carries the ONLY inbound link to the off-nav /operators/ („Operatoren verwalten")
```

---

## 2 · The one product defect — TASK-215

The rule is real and structural: `createOperator` claims the number in one writable CTE, so
`phone_identities`' primary key raises `23505` and the route answers `409 phone_claimed`. What
the director sees when they type a number a worker already holds:

```
„Diese Telefonnummer ist bereits vergeben."
```

That is prose, it is on the phone field, `aria-invalid="true"`, the drawer stays open with what
was typed, nothing is written, and no server token reaches the screen. **All of that is
correct.** What is missing is the reason, and it is missing everywhere:

- the standing hint under the field is about FORMAT only („Mit 0 oder +43 beginnen…");
- the refusal names no namespace;
- and the screen's own **„Auch Mitarbeiter"** column shows a person who IS both, so the screen
  is actively teaching the opposite of what it enforces. (Both is legal — `phone_identities`
  carries `worker_id` AND `operator_id` on one row — but only an admin can link them, and this
  screen's create path can only ever INSERT a fresh claim.)

**And the obvious fix does not work.** Found by running it: the `gap-closed` mutant writes the
sentence into `operators.phoneHint`, and the gap stays green, because

```tsx
help={phonePreview === null ? t('phoneHint') : t('phonePreview', { phone: phonePreview })}
```

swaps the standing hint for the „Wird gespeichert als: …" preview the moment the number parses.
A rule written into `phoneHint` alone is **off the screen exactly when it is being broken**.
That constraint is in TASK-215's notes with three options in ladder order.

The assertion is carried as `KNOWN_GAPS` — `audit-contrast`'s device, failing in both
directions — so the day the sentence lands, the check goes **STALE-GAP** and exits 1 until the
excuse is deleted. Proven, not asserted.

---

## 3 · Checks that were not checking. Three, all mine, all closed

| # | the hole | what got past it |
|---|---|---|
| 1 | `demo/audit-german.mjs` never loaded `/operators/` | the whole screen, at 390px, in German — off-nav routes are missed by any list written before they existed |
| 2 | …and its word scan read **leaf elements only** | every row action in this admin is `<button>Deaktivieren<span class="visually-hidden"> von Karin Bauer</span></button>`: the button has a child, so it is skipped and its own word is never counted. Adding the screen reported „Deaktivieren" ABSENT while 105px of button says it. Now reads each element's OWN text nodes; shown red in both directions |
| 3 | `demo/audit-phone.mjs` never loaded `/operators/` | 390 and 360, both themes: no sideways scroll and — the one this file exists for — six positional card captions on a table with a leading `<th scope=row>` |

Not a hole but a stated addition: contrast on this screen had only ever been measured as
**token pairs**. `check-operators` measures the rendered DOM, so a colour nobody put in
`audit-contrast`'s `PAIRS` list is now scored too.

---

## 4 · What the probe got wrong before it got anything right

Three fabricated defects, each found by disagreeing with a screenshot. Recorded because each
one is a trap for the next browser check in this repo:

1. **`oklch` comes back as `lab()`.** `getComputedStyle` resolves this design's tokens to
   `lab(66.7 -5.97 -57.2)`; a `[\d.]+` scrape drops the minus signs and the colour space and
   scored the accent link at **1.15:1**. Colours now resolve through a canvas — which is what
   `audit-contrast.mjs` already did, and its comment says why.
2. **A translucent background folded the wrong way.** `.note` paints `--accent-weak`
   (`oklch(… / 0.14)`); compositing outward-first threw the alpha away and reported grey text
   on full-strength blue at **1.11:1**, on a paragraph that renders at 7.16:1. Layers are now
   applied bottom-up.
3. **Headless Chrome does not tick an animation when nothing forces a frame.** `.drawer`
   animates from `translateX(100%)`, so `click(); sleep(250); getBoundingClientRect()` read the
   FIRST keyframe: the drawer one whole viewport to the right, reported as an overflow **at all
   eleven widths in both themes**. The entry animation is now finished explicitly.

All three would have gone into a report as product defects. Two of them had the exact shape of
findings this project has already chased once.

---

## 5 · Mutation: 22 counted, all fire, plus one honest ceiling

`sh demo/operator-mutants.sh` — each mutant reverts ONE true thing, rebuilds, and the check
must produce a failure **that mentions the property removed**. A non-zero exit with no FAIL
line is INCONCLUSIVE, never „caught".

```
hide-inactive   unmarked        generic-409     raw-token      no-phone-col
no-preview      no-notice       code-no-focus   code-no-once   revoke-direct
soft-consequence no-trap        no-restore      wide-table     dim-muted
dot-not-word    gap-closed      phone-drawer-wide
w-rate-optional w-rate-nohint   w-rate-passes   w-generic-error w-no-link
                                                             → every negative case fires
```

Four of them earned their keep immediately:

- **`revoke-direct`** removed the confirmation and the probe reported *„the probe reached the
  end of the run"* — a defect about the screen surfacing as a defect about the probe. Both
  confirmations now use a non-throwing wait and say what is missing: *„NOTHING ASKED — one
  click blocked the code, with no way back and no confirmation."*
- **`gap-closed`** is §2's discovery.
- **`no-trap`** did not compile (`allowUnreachableCode` is off), which is not a measurement. It
  was replaced with a better inverse that does compile: focus landing outside is still pulled
  back, only the wrap at the two edges is gone — the classic half-built trap.
- **`phone-drawer-wide`**'s first spelling mutated `.drawer { width: min(440px, 100vw) }` and
  the check stayed green — correctly, because the phone width comes from the
  `@media (max-width: 767px)` override, so nothing at 390 had changed. The harness said
  *"GREEN with the truth reverted — nothing tests it"*, which is the harness working. The
  mutant now removes the override.

**The ceiling, printed every run and not counted:** `by-label` makes `useOverlay` restore focus
by re-finding the opener by tag+label (its own `again()` fallback) instead of using the node.
The check **stays green**, because React does not replace that button on this screen — so
*„focus returns to the EXACT node"* is, here, as strong as the re-render is. The marker
property would catch a replaced node; nothing on `/operators/` replaces one.

---

## 6 · Unobserved — not passes

| what | why |
|---|---|
| **the operator's own phone** | redeeming the code is Android (W2/W3), out of scope by brief. No device, no tap |
| **a real screen reader** | live regions, roles and names are asserted in the DOM; nothing was heard |
| **`opener` identity under a re-render** | §5's ceiling. Nothing on this screen replaces the opener node |
| **13 of 25 overlay traps elsewhere** | `audit-overlays` census, named ceilings, unchanged by this run (`TASK-207`) |
| **decisions 41–44** | still PROPOSED. `check-worker-form` measures the screen AS BUILT and rules on nothing; if the owner rules against 41, that file is the list of sentences that come back out |

---

## 7 · The suite, at `678e4e5`

| check | result |
|---|---|
| `sh demo/check-guards.sh` | OK — 16 refusals, 64 files parse |
| `DEMO_BASE=…:8080 node demo/check-operators.mjs` | **50 ok, 1 named gap**, exit 0 |
| `DEMO_BASE=…:8080 node demo/check-worker-form.mjs` | **9/9**, exit 0 |
| `sh demo/operator-mutants.sh` | **every negative case fires** (23 counted, 1 exploratory) |
| `AUDIT_BASE=…:8080 node demo/audit-widths.mjs` | **442/442** — 11 widths × 20 states × 2 themes, /operators/ included |
| `AUDIT_BASE=…:8080 node demo/audit-overlays.mjs` | 105/105, census 12/25 + 13 named ceilings |
| `AUDIT_BASE=…:8080 node demo/audit-overlays2.mjs` | 25/25 |
| `AUDIT_BASE=…:8080 node demo/audit-keyboard.mjs` | 14/14 |
| `AUDIT_BASE=…:8080 node demo/audit-phone.mjs` | **28/28** — with `/operators/` at 390 and 360 |
| `AUDIT_BASE=…:8080 node demo/audit-german.mjs` | **10/10** — with `/operators/`, and a word scan that can see a button |
| `node demo/audit-icu.mjs` | 17/17 |
| `cd web && pnpm check` | All checks passed — exact de/en key parity, ICU args, every plural has `one` and `other` |
| `DEMO_BASE=…:8080 node demo/check-ia-greyscale.mjs` | PASS |

**i18n, shown red first rather than trusted:** deleting one German key made
*„key set identical to en.json"* fail and name the key; adding a plural with only an `other`
branch to the operators namespace made *„every plural has a one AND an other branch"* fail in
both files. Both restored, `git status web/` clean.

---

## 8 · Cleanup

- `nfc_demo` reseeded after the two writing audits, and `check-operators`' own teardown asserts
  its three counts independently (`operators 3→3 · identities 4→4 · codes 0→0`). Every `PROBE %`
  row deleted; the paste-able teardown SQL is in the file's header for a run killed mid-flight.
- `web/out` left as a **keyed** build, deliberately — `pnpm verify` would overwrite it with a
  keyless one and every map assertion on this machine would go quiet (`build-guard.mjs`).
- No `git add -A`. Every commit stages explicit paths. `gitleaks` clean;
  `PSST_SKIP_SCAN=1` used only where the sole match is the local demo admin password that
  twenty other files in `demo/` already carry.
- The server on `:8080` was **reused, not restarted**: no file under `server/` is newer than its
  boot, so it is this tree's code.
