# Redesign inventory — every admin screen state that must survive

Status: reference. Written BEFORE any CSS changes, as the checklist the final review runs against.
Scope: `web/` only. iOS deferred (TASK-129), server behaviour out of scope.
Source: read from code at `web/app/**/page.tsx`, `web/components/*`, `web/lib/*`, `web/messages/de.json`.
Method: every claim below was read out of the file named, not inferred from the screen name.

⚠ **`docs/brand/DESIGN.md` does not exist in the repo.** `docs/brand/` contains `prototype.html`
and nothing else. The prototype is therefore the only written design artefact available, and it
wins by default. Accent amendment (owner, verbal): BLUE — `oklch(.72 .17 250)` dark /
`oklch(.55 .12 250)` light, as already in the prototype.

Counts: 13 admin screens (`app/page.tsx` + 12 `app/*/page.tsx`), plus `/reinigung/` (client portal,
stated exception) and `app/not-found.tsx` (14th route, inherits the shell).

---

## 0 · Global chrome — applies to all 13, none of it may be lost

`app/layout.tsx` → `IntlProvider` → `ResponsiveTableLabels` → `AppShell`.

| Element | File | Must survive |
| --- | --- | --- |
| Skip link → `#main-content` | `AppShell.tsx` | `a11y.skipToContent`; `<main tabIndex={-1}>` so focus actually moves |
| Landmarks banner/nav/main/contentinfo | `AppShell.tsx` | four landmarks, in that order |
| Brand link home | `AppShell.tsx` | `app.brand` + `app.brandSuffix` |
| Locale switcher | `LocaleSwitcher.tsx` | de/en select; **a WRITE to client locale state**, reversible |
| Sign out | `LogoutButton.tsx` | POST logout; redirects to `/login/` **even on failure** |
| Footer note | `AppShell.tsx` | `footer.note` |
| Sidebar | `SidebarNav.tsx` | group labels are `<p class=nav-heading>` NOT headings (would precede the page `h1`); `aria-labelledby` supplies grouping; `aria-current="page"` |
| `FUTURE_NAV` block | `lib/nav.ts` | currently EMPTY and the empty case is load-bearing — heading renders only when non-empty. Machinery must stay |
| Card labels on phone | `ResponsiveTableLabels.tsx` | labels **all** row children in document order (`th` first), `MutationObserver` re-labels after fetch. Breaking this captions a timestamp "Objekt" |
| No-chrome routes | `AppShell.tsx` | `/login/` → bare `auth-main`; `/reinigung/` → children untouched |
| 404 | `app/not-found.tsx` | German `notFound.*`, renders INSIDE the shell, has a way out |

Nav today = 12 flat entries in `PRIMARY_NAV`. Prototype target: `Übersicht`, `Schichten`,
group **Stammdaten** (Mitarbeiter, Objekte, Kunden), group **Auswertung** (Lohn, Ergebnis),
`Konto` pinned bottom. **The regrouping must not drop a route** — 12 entries must still be
reachable: dashboard, shifts, material-requests, workers, locations, clients, inventory,
contracts, payroll, pl, analytics, account.

Shared error vocabulary (`messages.error`, 7 keys, `lib/locale.ts` `ErrorKey`):
`network` · `auth` · `notFound` · `conflict` · `request` · `server` · `badResponse`.
Every screen renders these through `tError(...)` in a `role="alert"`.

Shared 401/403 behaviour: **every** admin screen has `handleAuthLoss` →
`router.replace('/login/')`. Rationale stated in-code repeatedly: *a dead session must not
render an empty table that reads as "no data"*. Non-negotiable, all 13.

Shared time rule: `BUSINESS_TIME_ZONE = 'Europe/Vienna'`, pinned explicitly on every
`format.dateTime` call. Austrian month names come from `htmlLang('de') → 'de-AT'` and a hand-built
`Intl.DateTimeFormat` on `/payroll/`, `/pl/`, `/contracts/`, `/analytics/`, `/reinigung/` —
`"Jänner"`, not `"Januar"`. Never remove the explicit `timeZone`.

Shared money rule: integer cents in, `cents / 100` only at the `Intl` boundary,
`parseEuroToCents` / `centsToPlainEuros` (`lib/money.ts`) everywhere else. Tabular numerals.

---

## 1 · `/` Dashboard — `app/page.tsx` (337 lines, ns `home`, 35 keys)

**Frage:** „Muss ich gerade etwas tun?"

Data: one round trip, `GET /admin/data` (`fetchAdminSnapshot`), sliced five ways.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `snapshot === null` | `<p role="status">home.loading` |
| error | any non-401 fetch failure | `.form-error role=alert` with `tError(key)`; **rendered above and independently of the snapshot** |
| 401/403 | `ApiError.status` 401\|403 | `router.replace('/login/')`, nothing rendered |
| answer line, all clear | `problemCount === 0` | `home.allClear` plural incl. `=0` branch (`Nichts zu tun. Zurzeit ist niemand eingestempelt.`) |
| answer line, work to do | `problemCount > 0` | `home.needsAttention` — `problemCount = unresolved + workersWithoutEmail + locationsWithoutShifts` |
| on-site empty | no open shift | `home.onSiteEmpty` |
| on-site rows | `end_time === null`, sorted **oldest first** (closest to the 8h timer at the top) | table worker/location/since/elapsed |
| overdue flag | `minutesOnSite >= 480` | ` — home.overdueFlag` appended as **TEXT**, deliberately not colour |
| as-of stamp | always with the on-site block | `home.asOf` — the elapsed times are frozen at load, **not a ticking clock** (per-second live-region churn = screen-reader DoS) |
| refreshing | `busy` | button text `home.refreshing`, `aria-busy` on the table |
| triage: 3 bullets | always | each bullet has a none-variant and a some-variant + link |
| truncation | `shifts.length >= shift_limit` (2000) | `home.truncatedNote` — a truncated payload must not read as "this building was never cleaned" |
| recent activity | last 10 completed shifts | **no period filter, no total, no badge, no colour, not in `problemCount`**, rendered LAST |
| recent empty | none completed | `home.recentEmpty` |

### Writes
| Write | Reversible |
| --- | --- |
| none — refetch only | n/a |

### Load-bearing truth
- `home.recentScope` — „Die {count} zuletzt abgeschlossenen Schichten, **ohne Zeitraumfilter**. Das ist keine Summe – hier wird nichts zusammengezählt." The whole reason the block exists: a director once read an (correctly) empty exception view as data loss.
- `home.asOf` + the refresh control — the elapsed column is stale by design and says so.
- `home.truncatedNote` with the literal limit.
- `home.overdueFlag` as words.
- The **named** lists in the triage bullets (`names: …join(', ')`) — a count alone is not actionable.
- Comment-level constraint: a „hours this month" tile was rejected — on the 3rd of a month it reads EUR 0,00 and raises a false alarm. Do not add one during the redesign.

### Cross-links (filters pre-passed)
| To | Filter passed | Note |
| --- | --- | --- |
| `/shifts/` ×2 (`unresolvedLink`, `recentLink`) | **NONE** | ⚠ target defaults to `last30Days`; an unresolved shift older than 30 days is not on screen after the jump. Redesign opportunity, not a regression to introduce |
| `/workers/` (`noEmailLink`) | none | |
| `/locations/` (`deadTagLink`) | none | |

**Class: REPORT + triage.** No writes → no drawer. Prototype §4 is literally this screen.

---

## 2 · `/shifts/` — `app/shifts/page.tsx` (943 lines, ns `shifts`, 84 keys, 12 inputs)

**Frage:** „Welche Schichten halten die Lohnabrechnung auf, und was muss ich korrigieren?"

Data: `fetchShiftSnapshot` = **unbounded** `/admin/data` (no `?from=&to=`), filtered in the browser.
This is deliberate and documented: a server-bounded fetch could not say *"nothing in August — 5 shifts
exist in earlier periods"*, and that distinction was the difference between "fine" and "our payroll
data is gone".

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `snapshot === null` | `shifts.loading` |
| error | fetch/save 5xx/offline | `.form-error role=alert` |
| 401/403 | | redirect |
| genuinely empty DB | `shifts.length === 0 && shift_bounds.latest === null` | `shifts.emptyBody` |
| empty **filter**, nothing outside | `visible.length === 0 && outsideCount === 0` | `.notice` + `emptyFiltered` |
| empty **period**, rows outside | `visible.length === 0 && outsideCount > 0` | `emptyOutside {count}` + `latestRecorded {date}` + **two escape buttons**: `showAll` and `jumpToLatest {period}` |
| result count line | always, `role=status` | `resultCount` + (`noneBlocked` \| `blockedCount`) + `outsideCount`, joined into ONE sentence. `noneBlocked` is suppressed when the table is empty (a claim about nothing) |
| truncation | `shifts.length >= shift_limit` | `shifts.truncated {limit}` |
| period range label | always | `rangeLabel {from,to}` with the half-open end shown as `to − 1 ms`; `rangeAll` for `all` |
| domain: open | `end_time === null` | state cell `stateOpen`, duration cell `durationRunning`, end cell `endMissing`, row `.row-attention` |
| domain: unresolved | `auto_closed && corrected_at === null` | `stateUnresolved` + `notPayable`, `.row-attention` |
| domain: resolved | `corrected_at !== null` | `stateResolved` + `payable` |
| domain: complete | otherwise | `stateComplete` + `payable` |
| origin: hand-entered | `client_uuid === null` (`isManualEntry`) | own column, `originManual` |
| origin: tapped | else | `originTap` |
| correction idle | `draft === null` | `correctIdle` |
| correction of an unresolved shift | `shiftState(original) === 'unresolved'` | `.notice correctUnresolvedNotice` — **saving RESOLVES it and puts its hours into payroll even if nothing was retyped** |
| inactive worker/location in the edit selects | `!active && id === original.*` | still listed, wrapped in `inactiveOption {name}` |
| clash on create | `overlappingShift(...)` locally | named refusal `errorOverlap {worker,location,from,to}` |
| clash the client cannot see | server 409 | `errorOverlapUnknown` |
| create saved | | `createSaved`, focus → `newHeadingRef` |
| correction saved | | `saved`, focus → `correctionRef` |
| shift gone | PATCH 404 | `errorGone` |
| rejected | 4xx | `errorRejected` / `errorCreateRejected` |

Field-level errors (both forms): `errorStartRequired`, `errorStartInvalid`, `errorEndRequired`,
`errorEndInvalid`, `errorEndBeforeStart`, `errorFuture`, `errorWorkerRequired`, `errorLocationRequired`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Correct a shift (start/end/worker/location; only CHANGED fields patched) | `PATCH /admin/shifts/:id` | ⚠ **effectively no** — resolving stamps `corrected_at`; the previous state is not restorable from the UI |
| File a shift by hand | `POST /admin/shifts` | ⚠ no delete route exists in `lib/api.ts` — a wrong hand entry can only be corrected, never removed |

### Load-bearing truth
- `createManualNotice` — stated **before** the form: what this produces is a shift marked hand-entered for ever.
- `correctUnresolvedNotice` — the accept-the-timer's-guess side effect.
- The `colOrigin` column itself — `client_uuid IS NULL` is the only record that a human typed a row, and payroll gets audited.
- `notPayable` / `payable` in words next to every state.
- `timeZoneHint` under both forms and on the filter bar.
- `truncated {limit}`, `outsideCount`, `latestRecorded` — the three sentences that keep "empty" from reading as "gone".
- Filters are **client-side over an unbounded payload**. If the redesign moves filtering to the server, `outsideCount` and `emptyOutside` become unimplementable. Do not.

### Cross-links
None outgoing. This screen is the *target* of five inbound links (dashboard ×2, payroll ×3, pl ×2, analytics ×1) and **none of them pre-passes a filter**.

**Class: MIXED — hardest.** Read-only log + two permanently-open forms (create, correct) + three filters.

---

## 3 · `/material-requests/` — (663 lines, ns `materials`, 81 keys)

**Frage:** „Worauf wartet gerade jemand, der im Objekt steht?"

Data: `fetchMaterialSnapshot` (requests + locations + inventory), cap `ADMIN_MATERIAL_REQUEST_LIMIT = 500`.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `snapshot === null` | `materials.loading` |
| error | | `.form-error role=alert` |
| 401/403 | | redirect |
| summary | always | `materials.summary {decide, order, deliver}` in `.page-summary role=status` |
| unpriced warning | `isUnpriced(r)` count > 0 | `.notice unpricedWarning {unpriced}` + link to `/pl/` |
| truncation | `requests.length >= limit` | `materials.truncated {limit}` |
| empty **open** queue | filter=open, nothing open | `emptyOpen` + button `emptyShowAll {total}` when history exists |
| empty **all** | filter=all, nothing at all | `emptyAll` |
| stage: decide | `submitted` | `stageDecide`, row `.row-attention` |
| stage: order | `approved` | `stageOrder` |
| stage: deliver | `ordered` | `stageDeliver` |
| stage: done | `arrived` | `stageDone`; timeline splits `timelineArrived` vs `timelineSeen` (`seen_at` set) |
| stage: refused | `rejected` | `stageRefused` |
| cost: missing | `cost_cents === null` **and** past decision | `costMissing`, NOT muted |
| cost: not yet due | `cost_cents === null`, still early | `costNotYet`, muted |
| item unmapped / mapped / mapped+qty | `item_name`, `quantity` | `itemUnmapped` \| `itemMapped` \| `itemMappedQuantity` |
| no building named | `location_name === null` | `noLocationNamed` |
| admin note present | | `adminNote {note}` |
| detail form open | `draft !== null` | panel above the table, `tabIndex={-1}`, focus moves to it |
| row moved under us | PATCH 409 | `errorMoved` + **automatic reload** |
| unchanged submit | empty patch | `detailUnchanged`, closes without a request |

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Advance status (`submitted→approved/rejected`, `approved→ordered`, `ordered→arrived`) | `PATCH /admin/material-requests/:id {status}` | ⚠ **no** — `MATERIAL_TRANSITIONS` is forward-only; `rejected` and `arrived` are terminal |
| Save paperwork (item, quantity, cost, location, admin note; only changed fields) | same route | yes — editable again |

### Load-bearing truth
- Standing callout, three items, permanently on screen:
  `notePolling` (there is **no push**; "arrived" means the row moved, not that a phone buzzed),
  `noteAttribution` (decision-6: materials split pro-rata by labour hours; the building select is **context**, not cost attribution),
  `noteUnpriced` (an ordered request with no cost is silently worth zero and inflates every margin).
- `locationHint` sits **at the control** that would otherwise imply cost attribution.
- The worker's words rendered verbatim inside `<q>` — must stay quoted so it is obvious they are not ours.
- `unpricedWarning` count.

### Cross-links
`/pl/` (`plLink`, `noteUnpriced` context) · `/inventory/` (`itemCatalogueLink`). No filter passed.

**Class: MIXED.** Read-only queue with per-row lifecycle buttons + an optional detail form. The
lifecycle buttons are the *point* of the screen — keep them on the row; only the paperwork moves
into a drawer.

---

## 4 · `/workers/` — (643 lines, ns `workers`, 61 keys, 5 inputs)

**Frage:** „Wer darf Stunden erfassen, und wie kommt diese Person in die App?"

Data: `fetchWorkers`. Ticks every 30 s (`CODE_TICK_MS`) so an expired code stops being reported as live.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `workers === null` | `workers.loading` |
| genuinely empty | `workers.length === 0` | `workers.emptyBody` |
| error / 401 | | `.form-error` / redirect |
| create vs edit | `draft.id === undefined` | `createHeading` / `editHeading`, `submitCreate` / `submitSave`, cancel button only when editing |
| saved | | `workers.saved`, focus → name input |
| email taken | 409 | `errorEmailTaken` **on the email field** and in the form error |
| rejected | other 4xx | `errorRejected` |
| server/offline | 0 or 5xx | promoted to page-level `loadError` |
| domain: no email | `email === null` | `noEmail` muted — this person **can never sign in on iPhone** (decision-22) |
| domain: no phone | `phone === null` | `noPhone` muted; otherwise a `tel:` link |
| domain: inactive | `!active` | `.row-inactive` + `statusInactive` in WORDS |
| code: none | `codeStateOf === 'none'` | `codeNone` |
| code: live | not expired, not redeemed | `codeLive {expires}`; button says `codeReissue`; **revoke button appears** |
| code: expired | past `enrolment_code_expires_at` | `codeExpired {expires}` |
| code: redeemed | `enrolment_code_redeemed_at` set | `codeRedeemed {date}` |
| code: inactive worker | `!active` | `codeInactive` — „Inaktiv – kein Zugangscode möglich", no issue button |
| fresh code panel | after issue | `.notice.share-panel`, `tabIndex={-1}`, **focus moves to it**, shows the code once |
| copy ok / failed | clipboard | `codeCopied` / `codeCopyFailed` in a permanent live region |
| revoke ok / failed | | `codeRevoked {name}` / `codeRevokeFailed` |
| issue failed | | `codeIssueFailed` |

Field errors: `errorNameRequired`, `errorEmailShape`, `errorPhoneShape`, `errorRateInvalid`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Create worker | `POST /admin/workers` | ⚠ soft only — no delete, deactivate instead |
| Edit worker (all columns re-sent) | upsert | yes |
| Deactivate / reactivate (`toggleActive`, re-sends **every** column) | upsert | yes — but omitting a column here silently erases it |
| Issue enrolment code | `POST …/enrolment-code` | ⚠ **destructive**: replaces the previous code, which stops working immediately. The new one is shown ONCE |
| Revoke enrolment code | `DELETE …/enrolment-code` | **no** — irreversible, idempotent |

### Load-bearing truth — highest density on any screen
- `codeStandingNote`, rendered **above** the buttons that create a code, permanently: shown once, cannot be looked up, lost → create a new one; **and** the code is the *second* path, the email address is still what gets an iPhone in. This paragraph exists to stop a director concluding the email field is optional.
- `codeOnce` inside the fresh-code panel + `codeValidUntil {expires}` + `codeExplain {name}`.
- `emailHint` — must match the address Apple sends; „E-Mail-Adresse verbergen" → enter the relay address.
- `phoneHint` — the phone number is **NOT** a login, in capitals in the German string.
- `codeInactive` — why a deactivated worker gets no button.
- Revoke sits in the open at the same visual weight as issue, on purpose (seconds matter when a code went to the wrong person). **Do not bury it in a menu.**

### Cross-links
None outgoing. Inbound: dashboard `noEmailLink`.

**Class: MIXED.** List + permanently-open create/edit form + a one-shot secret panel that must NOT
become a modal that hides the row it belongs to (explicit in-code reasoning: the director reads the
code out over the phone). If the redesign uses the prototype's centred modal for the code, it must
still allow the underlying row to be identified — the prototype's modal titles it
"Zugangscode für Marta Nowak", which satisfies this.

---

## 5 · `/locations/` — (1160 lines, ns `locations`, 105 keys, 14 inputs) — the worst offender

**Frage:** „Welche Objekte betreuen wir, was steht auf ihrem Tag, und liegen wir bei der vereinbarten Zeit?"

Data: `fetchBuildingsSnapshot` = locations + clients + contacts + portal grants + shifts + `shift_bounds` + `shift_limit`.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `snapshot === null` | `locations.loading` |
| genuinely empty | `locations.length === 0` | `emptyBody` |
| error / 401 | | `.form-error` / redirect |
| create vs edit | `draft.id === undefined` | `createHeading` / `editHeading` |
| saved | | `locations.saved` |
| slug taken | 409 | `errorSlugTaken` on the slug field |
| rejected | 4xx | `errorRejected` |
| partial save | client/contact created, building save failed | both already exist, form is **re-pointed at them**, `load()` re-runs — pressing Save again cannot create a duplicate |
| new-client sub-form | `clientChoice === 'new'` | one extra input |
| new-contact sub-form | `contactChoice === 'new'` | three extra inputs |
| contact select disabled | `clientChoice === ''` | `contactNeedsClientHint` |
| month filter invalid | `!MONTH_RE.test(month)` | `aria-invalid`, time map empty |
| month empty, ledger has data | `monthTime.size === 0`, `latest !== null` | `.notice` `monthEmpty` + `monthLatest {date}` + button `monthJump` |
| month empty, ledger empty | `latest === null` | `monthEmpty` + `monthNever` |
| truncation | `shifts.length >= shift_limit` | `truncatedNote {limit}` |
| contract: none | `monthly_contract_cents === null` | `contractNone` |
| contract: priced | | `contractValue {amount}` |
| target: none | `target_minutes_per_month === null` | `timeTargetNone` |
| target: over / under / exact | compare to actual | `timeOver {delta}` / `timeUnder {delta}` / `timeExact` |
| target not a whole hour | `target % 60 !== 0` | hours field left **empty** + `targetStored {value}` hint — never silently rounded |
| pending time | shift open or unresolved in the month | `timePending {count}` — counted as PENDING, **never added to hours** |
| address missing | | `noAddress` muted |
| client / contact missing | | `noClient` / `noContact` |
| inactive row | `!active` | `.row-inactive` + `statusInactive` in words |
| inactive option in a select | | `optionInactive {name}` |
| share: no contact | | `shareNoContact` |
| share: contact inactive | | `shareContactInactive {name}` |
| share: building inactive | | `shareInactiveBuilding` |
| share: grant exists | | `shareActive {name,date}` + `shareStop` + `shareNew` |
| share: mintable | active contact + active building | `shareButton {name}` |
| fresh link panel | after mint | `.notice.share-panel` in `role=status aria-live=polite`, URL verbatim, copy button, `shareExplain`, `shareOnce` |
| share failed / stop failed | | `shareFailed` / `shareStopFailed` |
| copy failed | insecure origin / refusal | `copyFailed {name}` — never a false success |

Field errors: `errorNameRequired`, `errorSlugRequired`, `errorSlugShape`, `errorSlugTaken`,
`errorClientNameRequired`, `errorContactNameRequired`, `errorContactNeedsClient`,
`errorContactEmailShape`, `errorContactPhoneShape`, `errorMonthlyInvalid`, `errorTargetInvalid`,
`errorRejected`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Create / edit building (14 fields) | `POST /admin/locations` upsert | yes |
| Create client inline | `saveClient` | soft only |
| Create contact inline | `saveContact` | soft only |
| Deactivate building | `DELETE /admin/locations/:id` | ⚠ **also revokes that building's live client links** — an access decision about an outsider, deliberately not left to the admin remembering the Kundenlink column |
| Reactivate building | full upsert (every column re-sent) | yes — omitting a column would clear it |
| Mint client portal link | `createClientLink` | shown once; superseding mints a new one |
| Revoke client portal link | `revokeClientLink` | **no** |

### Load-bearing truth
- **`tagExplainer`** — write the URI on the tag exactly; the identity is the UUID, the slug is a human label and is **never** on the tag (decision-21).
- The full **`tagUri(location.id)`** rendered verbatim in a `code-block` + one-click copy + the UUID printed underneath (`uuidLabel`). A wrong sticker costs a site visit. **This is the single most load-bearing control on the screen.**
- `shareOnce` + `shareExplain {name}` — what the client can see (last cleaned, first name, duration, **nothing else**) and that the link is shown once.
- `monthEmpty` / `monthNever` / `monthLatest` — an empty month must never read as an empty database. Historic: hard-locking to the current month made the screen assert "40:00 unter der Sollzeit" on the 3rd, which is a false statement about a contract.
- `truncatedNote` — a capped payload can under-report a building's hours.
- `timePending` — pending is not zero.
- `targetStored` — a non-whole-hour target is named, never rounded away.
- `slugHint`, `addressHint`, `monthlyHint`, `targetHint`, `monthHint` (incl. „Wiener Ortszeit").
- Architectural: client and contact can be created **from this form**; `/clients/` is for tidying up and is never a prerequisite. Moving these into a drawer must keep the inline-create path.

### Cross-links
`/clients/` (`clientsLink`, no filter). Inbound: dashboard `deadTagLink`, analytics `panelBuildingLink`, contracts `noteMirrorLink` + `noBuildingsLink`.

**Class: MIXED — hardest, largest.** List + 14-field permanently-open form + a month filter + two
one-shot secret panels (tag URI is permanent, portal link is one-shot).

---

## 6 · `/clients/` — (631 lines, ns `clients`, 57 keys)

**Frage:** „Für welche Kunden arbeiten wir, und wem berichten wir dort?"

Data: `fetchClientsSnapshot` (clients + contacts + locations). **Two independent lists and two
independent forms on one screen** — this is the "two white containers" the owner complained about.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading (×2, both lists) | `snapshot === null` | `clients.loading` |
| clients empty | | `clientEmptyBody` |
| contacts empty | | `contactEmptyBody` |
| error / 401 | | `.form-error` / redirect |
| client create vs edit | `clientDraft.id` | `clientCreateHeading` / `clientEditHeading` |
| contact create vs edit | `contactDraft.id` | `contactCreateHeading` / `contactEditHeading` |
| saved (×2 separate regions) | | `clientSaved` / `contactSaved` |
| client with no buildings | | `noBuildings` muted |
| client with no people | | `noPeople` muted |
| contact with no email / phone | | `noEmail` / `noPhone` |
| inactive client / person | | `.row-inactive` + `statusInactiveClient` / `statusInactivePerson` (two DIFFERENT strings) |
| inactive in a select | | `optionInactive {name}` |
| unknown client on a contact | id not in list | `unknownClient` |

Field errors: `errorNameRequired`, `errorClientRequired`, `errorEmailShape`, `errorPhoneShape`, `errorRejected`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Create / edit client | `saveClient` | yes |
| Deactivate client | `deactivateClient` (DELETE) | yes via reactivate |
| Reactivate client | `saveClient {active:true}` | yes |
| Create / edit contact | `saveContact` | yes |
| Deactivate contact | `deactivateContact` (DELETE) | ⚠ **also revokes that person's live portal links, server-side** — the realistic reason to deactivate is that they left and must stop seeing our work the same minute. Reactivating does NOT restore the link |
| Reactivate contact | `saveContact {active:true}` | partially |

### Load-bearing truth
- `clients.intro` — both can be created straight from the buildings form; this page is for later correction.
- The contact-deactivation → link-revocation side effect (currently only in a code comment — ⚠ **it is not stated on screen today**; the redesign should surface it, and must not lose it).
- `contactEmailHint`.
- Two distinct inactive labels — do not collapse them into one string.

### Cross-links
`/locations/` (`buildingsLink`, no filter). Inbound: `/locations/` `clientsLink`.

**Class: MIXED (double).** Two lists + two forms. After the redesign: one read-only screen, two
drawers (client, contact).

---

## 7 · `/inventory/` — (394 lines, ns `inventory`, 37 keys)

**Frage:** „Welche Reinigungsmittel und Geräte gibt es, und was kostet ein Stück?"

Data: `fetchInventory`.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `items === null` | `inventory.loading` |
| genuinely empty | `[]` | `emptyBody` |
| error / 401 | | `.form-error` / redirect |
| create vs edit | `draft.id` | `createHeading` / `editHeading` |
| saved | | `inventory.saved` |
| item gone | 404 | `errorGone` |
| rejected | 4xx | `errorRejected` |
| kind product / equipment | `INVENTORY_KINDS` | `kindProduct` / `kindEquipment` — one list, the type is a control on the row |
| **unpriced** | `unit_cost_cents === 0` | `noCost` muted — **0 means "nobody has priced this", NOT "free"**. Rendering EUR 0,00 would feed a wrong number into a later cost calculation |
| inactive | `!active` | `.row-inactive` + `statusInactive` in words |

Field errors: `errorNameRequired`, `errorCostInvalid`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Create / edit item | `saveInventoryItem` upsert | yes |
| Deactivate / reactivate | same upsert, all columns re-sent | yes |

### Load-bearing truth
- `noCost` and the reasoning behind it (0 ≠ free).
- Empty cost input is *allowed* and means 0 = "not priced yet"; a **typo** is not and must not silently become zero.
- `kindHint`, `costHint`.
- Scope note (code comment): consumption per building is not tracked in this version; decision-6 will divide these pro-rata by labour hours. Nothing here feeds payroll yet.

### Cross-links
None outgoing. Inbound: `/material-requests/` `itemCatalogueLink`.

**Class: LIST.** The cleanest drawer candidate — 4 fields, 1 list, no filters.

---

## 8 · `/contracts/` — (670 lines, ns `contracts`, 69 keys)

**Frage:** „Womit war dieses Objekt zu welchem Zeitpunkt bepreist?"

Data: `fetchClientsSnapshot` for the buildings table, then `fetchContracts(locationId)` per selection.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading (buildings) | `snapshot === null` | `contracts.loading` |
| no buildings at all | `locations.length === 0` | `.notice noBuildings` + link to `/locations/` |
| loading (history) | `contracts === null && selected !== ''` | `historyLoading` |
| history empty | `contracts.length === 0` | `historyEmpty {name}` + `historyEmptyConsequence` + link to `/pl/` — a building nobody priced, whose P&L revenue is UNKNOWN |
| nothing selected | `selected === ''` | panel not rendered; the buildings table is the whole page |
| panel open | `building !== null` | `.contract-panel tabIndex={-1}`, **focus moves to it** |
| building unpriced | `monthly_contract_cents === null && active` | row `.row-attention` + `noPrice` muted |
| building inactive | `!active` | `.row-inactive` + `buildingInactive` note |
| no target | `target_minutes_per_month === null` | `noTarget` |
| period current | `valid_to === null` | `periodCurrent {from}`; **undo button drawn** |
| period closed | `valid_to !== null` | `periodClosed {from, to}` where `to = dayBefore(valid_to)` (exclusive bound rendered as the last day it applied) + `closedNoUndo` |
| no payer on a period | `client_id` unmatched | `noClient` |
| no note | | `noNote` |
| first contract vs replacement | `current === null` | `newIntroFirst` / `newIntroReplaces {amount, from}` |
| overlap refused | 409 on create | `errorOverlap` on the date field AND as form error |
| not current | 409 on delete | `errorNotCurrent` |
| created / deleted | | `created {building, from}` / `deleted {building}` |

Field errors: `errorDateRequired`, `errorDateShape` (real calendar day, `2026-02-31` rejected —
`new Date` would roll it to 2 March), `errorMonthlyInvalid`, `errorTargetInvalid`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Create a contract period | `createContract` | ⚠ only while it is the CURRENT one |
| Delete the current period (reopens its predecessor) | `deleteContract` | **no** — and the server refuses it for a closed period; the button is simply not drawn there |

### Load-bearing truth — standing callout, permanent, 4 items
- `noteRevenueHistory` — March keeps the March price for ever.
- **`noteLabourNoHistory`** — decision-28: `workers.hourly_rate_cents` is still ONE mutable column. **Revenue is period-correct; cost is not.** This is the same fact payroll states as `caveatRateHistory`; both copies must survive.
- `noteDates` — Vienna calendar days, half-open `[valid_from, valid_to)`.
- `noteMirror` + link — the buildings table mirrors the current price.
- `historyEmptyConsequence` — an unpriced building reports UNKNOWN revenue in the P&L.
- `validFromHint`, `monthlyHint`, `targetHint`, `clientHint` (payer at the time; defaults to the building's current client because a handover is exactly when a period gets recorded), `noteHint`.

### Cross-links
`/locations/` (`noteMirrorLink`, `noBuildingsLink`) · `/pl/` (`historyEmptyLink`). No filter passed
— ⚠ the P&L link does not carry the building or the period.
Inbound: `/pl/` `methodNoContractLink` + `flaggedContractLink`, `/analytics/` `panelContractLink`.

**Class: MIXED.** Read-only buildings table + a per-building history table + a create form inside a
panel. The panel is already close to a drawer; formalise it.

---

## 9 · `/payroll/` — (458 lines, ns `payroll`, 51 keys)

**Frage:** „Was muss ich diesen Monat an wen auszahlen?"

Data: `fetchPayrollSnapshot(range)` — **the period goes to the SERVER**; `GET /admin/data?from=&to=`
cuts the rows and the pre-aggregated `hours` with the same WHERE clause. Changing the period
**refetches** and clears the old snapshot first, so last period's rows never sit under this
period's heading.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading (incl. every period change) | `snapshot === null` | `payroll.loading` |
| error / 401 | | `.form-error` / redirect |
| summary | loaded | `payroll.summary {period, workers, hours, amount}` in `.page-summary role=status` |
| empty period, ledger has data | `totals.lines.length === 0`, `latest !== null` | `.notice emptyBody` + `emptyLatestRecorded {date}` + button `emptyJump {period}` |
| empty period, ledger empty | `latest === null` | `emptyBody` + `emptyNeverRecorded` |
| rows | | worker / hours / rate / amount / excluded + `tfoot` total |
| per-row exclusions none | | `excludedNone` muted |
| per-row exclusions | | `excludedUnresolved {count}` · `excludedOpen {count}` joined with ` · ` |
| export ok / failed | object-URL download | `exported` / `exportFailed` in permanent live regions |

### Caveat block (`.callout`, `caveatHeading` „Vor der Auszahlung") — every branch
| Branch | Condition |
| --- | --- |
| `caveatUnresolved {count}` + `caveatUnresolvedLink` → `/shifts/` | `unresolvedShifts > 0` |
| `caveatOpen {count}` + `caveatOpenLink` → `/shifts/` | `openShifts > 0` |
| `caveatNoneExcluded` | both zero |
| `caveatTruncated {limit, earliest}` | `periodExceedsCoverage(range, coverage)` **and** `earliestStart !== null` |
| **`caveatReconcile {server, visible}`** | `reconciliation.missingCents !== 0` |
| **`caveatReconcileOk`** | reconciled exactly |
| `caveatManual {count}` + `caveatManualLink` → `/shifts/` | `manualShifts > 0` |
| `caveatOrphan` | `orphanShifts > 0` — a shift referencing a worker not in the payload; „Bitte melden – das sollte nicht möglich sein." |
| **`caveatRateHistory`** | **ALWAYS**, unconditional |

### Writes
| Write | Reversible |
| --- | --- |
| CSV export (client-side Blob + object URL + anchor) — **not a server write** | n/a |

### Load-bearing truth — nothing here may be deleted, only re-typeset
- **The reconciliation line, both branches.** `caveatReconcile` names the server sum and the visible sum and says the total is too low; `caveatReconcileOk` states that nothing is missing. The OK branch is as load-bearing as the failure branch — silence would be indistinguishable from "not checked".
- **The named exclusion counts** — `caveatUnresolved`, `caveatOpen`, `caveatNoneExcluded`, and the per-row `excluded` column. decision-10 exclusions are counted, named and linked, never quietly dropped.
- **`caveatRateHistory`** — „Bekannte Einschränkung: Es wird nur ein Stundensatz pro Mitarbeiter gespeichert, vergangene Stunden werden daher zum heutigen Satz bewertet." The "priced at today's rate" caveat. Unconditional. Mirrored on `/contracts/` as `noteLabourNoHistory`.
- `caveatManual` — hand-entered shifts are paid in full and have no tag record. Also a **CSV column** (`csvManualShifts`): the accountant keeps the file, so the audit trail must be in it, not only on screen.
- `caveatOrphan`.
- `caveatTruncated {limit, earliest}`.
- `attributionHint` — „Eine Schicht zählt in dem Zeitraum, in dem sie begonnen hat, auch wenn sie nach Mitternacht endet."
- CSV filename uses **Vienna** `businessDate(range.from)`; the accountant files by that name. The BOM (`\uFEFF`) prevents Excel mangling umlauts. Anchor must be in the document and revoked on the next tick (Firefox ignores a detached anchor; Safari cancels if revoked in the same turn) — both fail **silently**.
- `PAYROLL_PERIODS` excludes `all`.

### Cross-links
`/shifts/` ×3 (`caveatUnresolvedLink`, `caveatOpenLink`, `caveatManualLink`) — ⚠ **no filter passed**;
the target opens on `last30Days` while payroll defaults to `lastMonth`. Documented gap.

**Class: REPORT.** No server writes → no drawer. Its problem is density, not modality.

---

## 10 · `/pl/` — (630 lines, ns `pl`, 82 keys)

**Frage:** „Welches Objekt trägt sich, und welches nicht?"

Data: `fetchPl(range)` — **every number comes from the server's SQL**, never from browser
arithmetic (a 2000-row cap would silently report a smaller month). This file adds a totals row and
the words. `all` is excluded — a monthly fee pro-rated over an unbounded period is meaningless.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `report === null` (also on every period change) | `pl.loading`; baseline shows `baselineLoading` |
| bad range | `!isClosedRange(range)` | `loadError = 'request'` |
| error / 401 | | `.form-error` / redirect |
| summary | | `pl.summary {period, buildings, flagged}` |
| empty | `report.buildings.length === 0` | `.notice emptyBody` + `emptyHint` — genuinely nothing to report |
| baseline unset | `baseline_margin_bp === null` | `baselineUnset` — **ships UNSET and nothing defaults it**; no building is flagged and the screen says so |
| baseline set | | `baselineCurrent {percent}` + a `baselineClear` button |
| baseline saved / cleared / failed | | `baselineSaved {percent}` / `baselineCleared` / `baselineFailed` |
| baseline invalid | `parsePercentToBp === null` | `errorBaselineInvalid` |
| revenue unknown | `revenue_cents === null` | `revenueUnknown` — **never EUR 0,00**; a zero would report a paying client as a total loss |
| revenue partial | `revenue_days < period_days` | `revenuePartial {days, periodDays}` |
| profit / margin unknown | null | `profitUnknown` / `marginUnknown` |
| assessment: below | `below_baseline === true` | `assessBelow`, row `.row-attention` |
| assessment: ok | `=== false` | `assessOk` |
| assessment: no contract | reason `no_contract` | `assessNoContract` |
| assessment: zero revenue | reason `zero_revenue` | `assessZeroRevenue` |
| assessment: no baseline | `below_baseline === null`, no reason | `assessNoBaseline` — **"not assessable" is NOT a pass** |
| building inactive | | `.row-inactive` + `buildingInactive` |
| row has excluded shifts | `excluded_unresolved_shifts > 0` | `rowExcluded {shifts}` |
| totals row | | `totalLabel` + `totalScope {buildings}` + `totalNotAssessable {buildings}` \| `totalAllAssessed` |
| flagged: no baseline | `baselineBp === null` | `flaggedNoBaseline` |
| flagged: none | `flagged.length === 0` | `flaggedNone {baseline}` (+ `flaggedNoneCaveat {buildings}` when some are unassessable) |
| flagged: one block per building | | `flaggedFor {name}` + the reasoning list + two links |

### Reasoning list (per flagged building — the ARGUMENT, not the verdict)
`whyMargin {margin, baseline, points}` · `whyRevenue {revenue, days, periodDays}` ·
`whyLabour {labour, hours, share}` · `whyMaterial {material, share}` ·
`whyExcluded {shifts, hours}` (decision-10, only when > 0) · `whyOpen {shifts}`.
`shareUnknown` when the denominator is null. Percentages via basis points (`bpToRatio`);
shortfalls printed as **percentage points**, not percent (`points()`).

### Methodology callout (`methodHeading`) — permanently visible, never a tooltip
`methodRates` \| `methodRatesUnknown` (chosen by `report.labour.rate_basis`; rendered from OUR
messages, not the server's German-only `rate_basis_note`) · `methodMaterials` ·
`methodMaterialPool {pool, priced}` · `methodUnpriced {unpriced}` + link → `/material-requests/` ·
`methodUnallocated {amount}` · `methodExclusions` · `methodNoContract {buildings, cost}` + link → `/contracts/`.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Set margin baseline | `saveSetting('pl_margin_baseline_bp', bp)` | yes — resettable and clearable |
| Clear margin baseline | `clearSetting(...)` | yes — re-settable |

### Load-bearing truth
- The three refusals, stated in the file header and enforced in the rendering: **no confident zero** for unknown revenue; **"not assessable" is not a pass**; **the baseline is never invented**.
- Every `method*` line — each one is something a reader would otherwise assume the opposite of.
- `whyExcluded` — those hours are real work not charged into this cost, so the true cost is **higher** than the row shows. A building looks cheap precisely while those are outstanding.
- `attributionHint`.
- „A flag is not a red dot" — the flagged block must remain a paragraph a director can read down a phone line. **Do not compress it into a badge.**

### Cross-links
`/material-requests/` (`methodUnpricedLink`) · `/contracts/` (`methodNoContractLink`, `flaggedContractLink`) · `/shifts/` (`flaggedShiftsLink`). ⚠ none pre-passes a building or a period.

**Class: REPORT** (with one settings write). The baseline form is the only drawer candidate here.

---

## 11 · `/analytics/` — (695 lines, ns `analytics`, 92 keys)

**Frage:** „Brauchen die Objekte mehr oder weniger Zeit als vereinbart, und wo liegen sie?"

Data: `fetchAnalytics(range, months)`. `TREND_MONTHS_DEFAULT = 6`, `TREND_MONTHS_MAX = 24`,
choices `[3, 6, 12, 24]`.

### The map — five named failure states, all ordinary, all on screen
| Status | Trigger | Message |
| --- | --- | --- |
| `noKey` | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` empty at build | `mapNoKey` — a deployment fact, not a fault |
| `noPins` | no building geocoded | `mapNoPins {unpinned}` |
| `loading` | script in flight | `mapLoading` |
| `ready` | drawn | `mapReady {pinned, unpinned}` |
| `blocked` | `gm_authFailure` — key refused / API not enabled. **Fires LATE: the script loads and `new Map()` succeeds first** | `mapBlocked` |
| `failed` + `timeout` | script never arrived | `mapTimeout` |
| `failed` + network | offline / ad blocker / proxy | `mapNetwork` + a `mapRetry` button |

The map container is **always in the DOM**, `hidden` rather than unmounted, so the ref exists when
the API resolves and no `Map` is constructed into a zero-height box. `mapTableHint` renders **only**
when `mapStatus === 'ready'` — printing "select a pin…" under "no map was drawn" is the screen
contradicting itself.

### Other render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | `report === null` | `analytics.loading` |
| bad range | `!isClosedRange` | `loadError='request'` |
| empty | `buildings.length === 0` | `.notice emptyBody` + `emptyLink` → `/locations/` |
| summary | | `analytics.summary {period, buildings, pinned}` |
| target unknown | `target_minutes === null` | `targetUnknown` |
| variance unknown / exact / over / under | | `varianceUnknown` / `varianceExact` / `varianceOver` / `varianceUnder`; table prints signed `+h:mm` explicitly because `formatDuration` only ever emits `-` |
| trend insufficient | `< 2` months with shifts | `trendInsufficient` — **NOT a flat line**, which would be a claim with nothing behind it |
| trend up / down / flat | | `trendUp {delta}` / `trendDown {delta}` / `trendFlat` — **direction in words, no lone arrow glyph** |
| geocode pinned | | `geoPinned` / `geoPinnedAt {when}` |
| geocode never attempted | | `geoNeverAttempted` + a retry button |
| geocode failed | | `geoFailed {status}` (+ `geoStatusUnknown`) + retry |
| retry outcomes | | `geoRetryPinned {name}` / `geoRetryNoPin {name,status}` (200 ≠ a pin came back) / `geoRetryNoAddress {name}` (422) / `geoRetryFailed {name}` |
| photo: shown | metadata already answered OK | `<img>` + `photoAlt {name}` |
| photo: absent | | `photoNoKey` \| `photoNoPin` \| `photoLoadFailed` \| `photoNotChecked` \| `photoDenied` (REQUEST_DENIED) \| `photoNoImagery` (ZERO_RESULTS) \| `photoUnavailable {status}` |
| panel open | pin click or `openDetails` | `.callout.building-panel tabIndex={-1}`, **focus moves to it**; `panelClose` returns |
| panel excluded line | | `excludedNone` \| `excludedSome {shifts, open, hours}` |
| building inactive | | `.row-inactive` |
| row excluded | `excluded_unresolved_shifts > 0` | `rowExcluded {shifts}` |

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Retry geocoding one building | `geocodeLocation(id)` | ⚠ idempotent-ish; overwrites `lat/lng/geocode_status/geocoded_at`. No undo, but re-runnable |

### Load-bearing truth
- **„The map is the optional part and the table is not."** Everything the map shows, the table shows too, for every building including the un-pinned ones. `noteMapEquivalent` states it. The table is the PRIMARY presentation — this is also what makes the screen keyboard- and screen-reader-usable without a second implementation. **A redesign must not demote the table.**
- Standing callout: `noteExclusions`, `noteTrend` (arithmetic, not a forecast), `noteTargetSource`, `noteMapEquivalent`.
- Every photo-absence reason — **never a grey rectangle presented as a building**. The Street View *image* endpoint serves a grey "no imagery" tile with HTTP 200, so metadata is checked first and `onError` is only the second line of defence.
- `.trend-bar` is `aria-hidden` decoration; the number to its left is the fact.
- The `<img>` is a plain `<img>` on purpose (static export has no image optimizer, decision-16) with an existing `biome-ignore`. Keep the ignore comment and its reasoning.

### Cross-links
`/contracts/` (`panelContractLink`) · `/shifts/` (`panelShiftsLink`) · `/locations/` (`panelBuildingLink`, `emptyLink`). ⚠ none pre-passes the building.

**Class: REPORT** (with one geocode write). Hardest report: a map, a detail panel, a nested trend
table and 7 photo states.

---

## 12 · `/account/` — (124 lines, ns `account`, 13 keys)

**Frage:** „Wie ändere ich mein Passwort?" — **the only screen that already states its question**
(`account.question`, rendered as `.lede`).

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| idle | initial | empty status region |
| saving | | button text `account.saving`, disabled |
| done | 200 | `account.done`, form reset |
| too short | `< MIN (5)` client-side | `tooShort {min}` |
| mismatch | next ≠ repeat | `mismatch` |
| wrong current | 401 | `wrongCurrent` |
| rejected | 422 | `rejected` |
| other API error | | `tError(messageKey)` |

One live region for **both** outcomes, so the page does not reflow differently for success and failure.

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Change admin password | `changePassword(current, next)` | **no** — only by changing it again, and only with the new password in hand |

### Load-bearing truth
- **No "reset by email" and the absence is deliberate**: the admin identity is a USERNAME, not an address, and this deployment has no outbound mail. A reset link we cannot send is a dead end that looks like a feature. Recovery is the operator, on the machine. ⚠ Currently only a code comment — the redesign may state it on screen but must not add a reset control.
- `account.hint {min: 5}` — must stay in step with `PASSWORD_MIN` in `server/routes/admin.js`.
- `autoComplete` values: `current-password`, `new-password`, `new-password`.

### Cross-links
None. Pinned to the bottom of the nav in the prototype.

**Class: pure FORM.** Already one job. It uses `.auth-form`, not `.worker-form` — the shared form
styling must keep covering both.

---

## 13 · `/login/` — (106 lines, ns `login`, 8 keys)

**Frage:** „Wie melde ich mich an?"

Renders **outside** the admin shell (`AppShell` returns a bare `auth-main`) — no nav, no sign-out,
no locale switcher.

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| idle | | empty `role=alert` region, always mounted |
| pending | | `login.submitting`, all inputs `disabled` |
| failed credential | any 4xx | `login.failed` — **ONE message for every rejected credential**; no "unknown user" vs "wrong password" oracle |
| transport / server fault | status 0 or ≥ 500 | `tError(key)` — these differ **only because they say nothing about the account** |
| success | | `router.push('/')` |

### Writes
| Write | API | Reversible |
| --- | --- | --- |
| Sign in (sets an httpOnly cookie server-side) | `login(email, password)` | yes — sign out |

### Load-bearing truth
- The single failure message. **Do not split it into friendlier per-cause messages during the redesign** — that is a user-enumeration oracle.
- The page never sees, stores or forwards a credential after the request (decision-20; the admin PIN is gone).
- `autoFocus` with an existing `biome-ignore` — single-purpose page, the form IS the page. Keep the ignore and its justification.
- Field is `type="text"` + `autoComplete="username"`, **not** `type="email"` — the identity is a username (live login is `schimmer`).

**Class: pure FORM.** No shell, no drawer.

---

## 14 · `/reinigung/` — CLIENT PORTAL, stated exception (196 lines, ns `portal`, 18 keys)

**Frage (an den Kunden gerichtet):** „Wann wurde mein Objekt zuletzt gereinigt, von wem, und wie lange?"

**This screen is NOT part of the admin redesign.** It must not inherit the admin shell, the admin
nav, the admin sign-out, the locale switcher, or any link that leads into the admin app. The person
reading it works for another company.

| Property | Value | Why |
| --- | --- | --- |
| Reached at | `/reinigung/#k=<token>` and nowhere else | `output:'export'` cannot emit a page per token; a dynamic route needs a server (decision-16). Fragment, so the token is never in a request line or a referrer |
| In `PRIMARY_NAV` | **no** | reached only via the link the director sends |
| Admin chrome | **none** (`AppShell` early-returns; renders its own `<main>`) | |
| Desktop guard | **none** (removed in decision-28, stated exception to decision-7) | opened on a phone |
| Locale | **German pinned** (`CLIENT_PORTAL_LOCALE`), `lang` set on the element itself | the prerendered file carries the build-time default (`en`) and this text is German either way |
| Fields rendered | exactly three per row: date, **first name**, duration | so a future server-side addition cannot leak through this screen |
| Document title | set on the client to `documentTitle {building}` | the root layout says "NFC TimeSheets Admin"; an outsider must not be told they have somebody's admin panel open |
| Styling | `.portal`, `.portal-card`, `.portal-table`, `.portal-status`, `.portal-empty`, `.portal-failure`, `.portal-note` | a separate style island — the admin token rework must not silently restyle it, and must not leave it unstyled either |

### Render states
| State | Trigger | Rendering |
| --- | --- | --- |
| loading | | `portal.loading` in a permanently-mounted `role=status` |
| ready, with rows | | `portal-table`, heading = the building's own name |
| ready, empty | `cleanings.length === 0` | `portal.empty` — not an error; says what it means |
| `linkInvalid` | missing/malformed fragment (**answered locally, nothing sent**) or any 4xx | `linkInvalid` + `linkInvalidHint`, **no retry button** |
| `tooMany` | 429 | `tooMany` + `tooManyHint` + retry |
| `loadFailed` | 5xx / transport | `loadFailed` + `loadFailedHint` + retry |
| unparseable date | regex miss | shown **verbatim** rather than inventing a day or hiding the row |

### Writes
None. Read-only by construction.

### Load-bearing truth
- **One message for unknown / revoked / building-switched-off.** Telling the reader "this used to work" is information about our client relationships, and a distinct message per cause is a probe.
- `portal.note`.
- Dates are already Vienna calendar days as `YYYY-MM-DD`, read and formatted in **UTC** so no zone can move them a day — the client checks these against their own diary.
- Row keys are array indices with a `biome-ignore` and a written justification (no id is returned and none may be; content is not unique). Keep both.

**Class: PUBLIC PORTAL — do not touch beyond token/colour parity.**

---

## Classification summary

### Pure LIST → read-only list + drawer for every write
| Screen | Writes to move into a drawer | Effort |
| --- | --- | --- |
| `/inventory/` | create/edit item (4 fields); deactivate stays a row action | **low** — 1 list, 1 form, no filters |

### Pure REPORT → no writes, so no drawer; a different problem (density, not modality)
| Screen | Notes |
| --- | --- |
| `/` dashboard | zero writes. Prototype §4 is literally this screen: answer band, then a "Zu erledigen" list, then the calm recent block |
| `/payroll/` | zero server writes (CSV is client-side). The caveat block is the density problem — **typeset smaller, never remove** |
| `/pl/` | one settings write (baseline) → the only drawer candidate. The flagged-building argument blocks must stay prose |
| `/analytics/` | one write (geocode retry) → stays a row action. Map + panel + nested trend table |

### MIXED → hardest, in descending order of difficulty
| Screen | Why | Effort |
| --- | --- | --- |
| `/locations/` | 1160 lines, 14 inputs, list + form + month filter + inline client & contact creation + a permanent tag-URI control + a one-shot portal link. Two secret-ish panels with different lifetimes | **high** |
| `/shifts/` | 943 lines, 12 inputs, **two** forms (create-by-hand, correct) with different rules, three filters, an unbounded client-side dataset that must stay unbounded | **high** |
| `/workers/` | list + form + a one-shot code panel whose "shown once" warning must stay ABOVE the buttons that create it | **medium–high** |
| `/clients/` | two lists + two forms on one screen — the literal "two white containers". Becomes one list screen + two drawers | **medium** |
| `/contracts/` | read-only buildings table + a per-building history panel that is already nearly a drawer | **medium** |
| `/material-requests/` | queue whose lifecycle buttons must STAY on the row (one click is the point); only the paperwork form moves | **medium** |
| `/account/`, `/login/` | already one job each; cosmetic only | **low** |

### Exception
| `/reinigung/` | public, no admin chrome, phone-first, German pinned, read-only, its own style island. **Must NOT inherit the admin shell.** |

---

## Cross-link map (and the filters none of them pass)

```
/            → /shifts/ (unresolved)      ✗ no filter  ⚠ target defaults last30Days
             → /shifts/ (recent)          ✗ no filter
             → /workers/                  ✗ no filter
             → /locations/                ✗ no filter
/payroll/    → /shifts/ ×3                ✗ no filter  ⚠ payroll=lastMonth, shifts=last30Days
/pl/         → /material-requests/        ✗
             → /contracts/ ×2             ✗ no building
             → /shifts/                   ✗ no building, no period
/analytics/  → /contracts/, /shifts/, /locations/   ✗ no building
/contracts/  → /locations/ ×2, /pl/       ✗
/materials/  → /pl/, /inventory/          ✗
/locations/  → /clients/                  ✗
/clients/    → /locations/                ✗
```

**Every cross-link in the app is a bare navigation.** No screen pre-passes a filter today. That is a
known defect, not a feature — but *adding* filter pre-passing is a behaviour change and is **out of
scope for a redesign turn**. Record it; do not build it. If a link's target period is changed as a
side effect of the redesign, the "empty period ≠ empty database" machinery on the target screen is
what stops it becoming a data-loss scare, and that machinery must survive intact.

---

## Truth that may never be deleted — flat checklist for the final review

Each line is a string or control that carries a fact nothing else on the screen carries.

1. `/locations/` `tagExplainer` + the verbatim `tagUri()` code block + the copy control + `uuidLabel` + the UUID.
2. `/locations/` `shareOnce`, `shareExplain` (what the client can see — and nothing else).
3. `/locations/` `monthEmpty`, `monthNever`, `monthLatest`, `monthJump`.
4. `/locations/` `timePending`, `targetStored`, `truncatedNote`.
5. `/workers/` `codeStandingNote` (shown once + the code is the SECOND path, email still required) — **positioned above the create buttons**.
6. `/workers/` `codeOnce`, `codeValidUntil`, `codeExplain`, `codeInactive`.
7. `/workers/` `phoneHint` (phone is NOT a login), `emailHint` (must match Apple's address; relay address).
8. `/workers/` the revoke control at the same weight as issue.
9. `/shifts/` `createManualNotice` **before** the form; the `colOrigin` column; `originManual`.
10. `/shifts/` `correctUnresolvedNotice` (saving accepts the timer's guess and pays it).
11. `/shifts/` `payable` / `notPayable` in words; `outsideCount`; `emptyOutside`; `latestRecorded`; `truncated`; `timeZoneHint`.
12. `/payroll/` **`caveatReconcile` AND `caveatReconcileOk`** — both branches.
13. `/payroll/` `caveatUnresolved`, `caveatOpen`, `caveatNoneExcluded`, per-row `excluded` column.
14. `/payroll/` **`caveatRateHistory`** (priced at today's rate) — unconditional.
15. `/payroll/` `caveatManual` + the `csvManualShifts` CSV column; `caveatOrphan`; `caveatTruncated`; `attributionHint`.
16. `/payroll/` CSV: Vienna-dated filename, UTF-8 BOM, attached anchor, next-tick revoke.
17. `/contracts/` `noteRevenueHistory`, **`noteLabourNoHistory`**, `noteDates`, `noteMirror`, `historyEmptyConsequence`, `closedNoUndo`.
18. `/pl/` `revenueUnknown` (never EUR 0,00), `assessNoBaseline` (not a pass), `baselineUnset`.
19. `/pl/` every `method*` line; `whyExcluded`; the flagged-building reasoning as prose.
20. `/analytics/` all five map states in words; all seven photo-absence reasons; `trendInsufficient`; `noteMapEquivalent` + the table as the primary presentation.
21. `/material-requests/` `notePolling` (no push), `noteAttribution` (decision-6), `noteUnpriced`, `locationHint` at the control; the worker's words in `<q>`.
22. `/inventory/` `noCost` (0 ≠ free).
23. `/` `recentScope` (no period filter, not a sum), `asOf`, `truncatedNote`, `overdueFlag`, named triage lists.
24. `/login/` the single failure message.
25. `/account/` no password-reset-by-email control.
26. `/reinigung/` one failure message for unknown/revoked/inactive; three fields only; German pinned.
27. `/clients/` two distinct inactive labels; ⚠ the contact-deactivation → link-revocation side effect (today only in a comment).

---

## Accessibility invariants observed in the current code (must be preserved or improved)

- **Permanently-mounted live regions.** Every screen renders `role="alert"` / `role="status"` paragraphs that are **empty** when there is nothing to say, rather than mounting a node on failure. The reason is written in six files: a text change inside an existing region is announced far more reliably than an appearing node. **A drawer/modal redesign must not replace these with conditionally-mounted toasts.**
- **Focus is moved deliberately** and to a named target, after: workers code panel (`codePanelRef`), materials detail (`detailRef`), contracts panel (`panelRef`), analytics panel (`panelRef`), shifts create (`newHeadingRef`) and correct (`correctionRef`), and back to the name input after every save on `/workers/`, `/locations/`, `/clients/`, `/inventory/` (because the submit button is disabled while saving and focus would otherwise fall to `<body>`).
- **State is never colour alone.** Every state cell renders a WORD; the class is a second signal. Stated in comments on `/`, `/shifts/`, `/workers/`, `/locations/`, `/inventory/`, `/clients/`, `/material-requests/`, `/pl/`, `/analytics/`. The prototype's 3px left rule is a **third** signal — it may not replace the word.
- **`aria-busy`** on tables during a write; **`aria-invalid`** + `aria-describedby` on every field with an error; **`aria-current="page"`** in the nav; `aria-pressed` on the two selection toggles (`/contracts/`, `/analytics/`).
- **`.visually-hidden` disambiguators** on every repeated row button (`forLocation`, `forWorker`, `forShift`, `forItem`, `forName`, `forBuilding`, `forRequest`, `forPeriod`). A table of identical "Bearbeiten" buttons is unusable by voice or screen reader without these.
- **Tables carry a `<caption class="visually-hidden">`.**
- New for the redesign, per the brief and the prototype: Escape closes overlays, focus **trapped** in an open drawer/modal and **restored** on close, 44 px minimum targets (the prototype already sets `min-height:44px` on inputs, 40 px on `.btn` — ⚠ **40 px is below the stated 44 px floor; raise it**), `prefers-reduced-motion` honoured (the prototype has the media query).

## Mobile invariants (decision-28)

- 768 px breakpoint; `.data-table` row→card transform; `ResponsiveTableLabels` supplies `data-label`.
- Labels are taken from **all** row children in document order — the `<th>` row header counts. Off-by-one here captions a timestamp "Objekt", and automated assertions stayed green while it was wrong. **Verify by looking at screenshots.**
- No horizontal scroll at 360 px.
- The prototype hides the sidebar entirely below 860 px (`.side{display:none}`) and offers **no replacement control**. ⚠ That is a navigation dead end on a phone — the redesign needs a drawer/menu affordance the prototype does not specify.

## Open questions the redesign must answer (not decided here)

1. Where does `/locations/`'s inline client+contact creation live once the building form is a drawer? Nested drawer, or a step in a two-step drawer (the prototype's `object` form says „Schritt 1 von 2")?
2. `/shifts/` has two forms with different validation (end time optional when correcting, required when creating). Two drawers, or one drawer with a mode?
3. `/clients/` becomes one screen with two entity types. One list with a segmented control, or two stacked read-only lists?
4. Does the fresh enrolment code stay an inline panel (current, justified: read out over the phone next to the row) or become the prototype's centred modal (which names the worker in its title)?
5. Phone navigation: the prototype deletes the sidebar under 860 px with nothing in its place.
6. `docs/brand/DESIGN.md` is missing — is there a copy elsewhere, or is `prototype.html` the whole specification?
