# iOS ↔ Android parity, and the next iteration

PLANNING ONLY. Nothing in this document was built. Every line number and every claim below
was read at HEAD `713dfa4` on 2026-08-24, not inferred from an earlier report.

WHY NOW. A real SMS was delivered to a real handset in production through
`POST /auth/sms/request` → Twilio (decision-48). Android can sign a worker in with a phone
number today; iOS cannot, and has never had any door except Sign in with Apple. The owner
asked for six things: iOS phone login, an honest message for an unregistered phone, the
removal of Settings ▸ Migration history, advice on a one-time local data wipe, a full parity
audit, and a sequenced backlog. This is the answer to all six.

READ FIRST, because it changes what is safe to build:

> **decision-45, decision-46, decision-48 and decision-40 are all still `status: proposed`.**
> Not accepted. Yet `/auth/sms/*` is deployed, an OTP was delivered to a handset, and this
> document proposes stacking a fourth mechanism (iOS phone login) on top of them. Per this
> project's own rule — *"the owner accepts decisions"* — the owner should accept or amend
> decision-45 and decision-48 **before** any of §2 or §3 is implemented. This is a five-minute
> bookkeeping act, and skipping it means the next iteration's largest piece of work rests on
> a foundation nobody has formally signed.

---

## 1 · Parity matrix

Verdicts are one of four. `N/A-PLATFORM` is not a polite way of saying "gap": it means the
feature **cannot** exist on that platform, and the constraint is named. A real gap is a real
gap even when it is small.

### 1.1 Worker sign-in

| # | Feature | iOS | Android | Verdict |
|---|---|---|---|---|
| 1 | Sign in with Apple (`POST /auth/apple`) | live — `Auth.swift`, `ContentView.swift:104` | never existed | **N/A-PLATFORM** — `AuthenticationServices` is Apple-only. TASK-33's own rationale: SIWA "cannot serve an Android worker" |
| 2 | Enrolment-code sign-in (`POST /auth/code`, decision-26) | **none** — no field, no call, no screen | live since 2026-08-03, `TimeSheetApp.kt:143` + `EnrolmentCode.kt` | **iOS GAP** — and iOS already has the pure `EnrolmentCode.swift` port from TASK-246 |
| 3 | SMS/OTP sign-in (`POST /auth/sms/request` + `/verify`, decision-48) | **none** | live, `TimeSheetApp.kt:285-418` | **iOS GAP** — the owner's requirement (1) |
| 4 | SMS capability probe (`GET /auth/capabilities`) | not called | called once at launch, fail-closed, `TimeSheetViewModel.kt:121` | **iOS GAP** — prerequisite of row 3 |
| 5 | Session restore at launch (`GET /auth/session`) | `Auth.swift:92` `restore()` | `restoreSession()` | PARITY |
| 6 | Sign-out (`POST /auth/logout`, revoke-then-drop) | `Auth.swift:227` | `model::signOut` | PARITY |
| 7 | "Not on the worker list" dead-end screen | `IneligibleView`, `ContentView.swift:159` | — | **N/A-PLATFORM** — it is the failure state of the Apple flow itself; a bad enrolment code has no separate eligibility step to fail |
| 8 | Apple credential-revocation check at launch | `verifyAppleCredentialState()`, `Auth.swift:115` | — | **N/A-PLATFORM** — Apple ID revocation is an Apple concept |
| 9 | **Unregistered phone gets a message telling them to contact their admin** | n/a (no phone login) | **none** — shows `sms_invalid_code`, `strings.xml:54` | **GAP ON BOTH + SERVER** — see §3. Not an iOS catch-up item |
| 10 | Queued unsent shifts shown on the SIGNED-OUT screen (TASK-225) | **none** — `SignInView` is a title, a sentence and Apple's button | `PendingCard` renders on the sign-in screen | **iOS GAP** — becomes urgent the moment §5's wipe forces a re-login |

### 1.2 Clock in / clock out

| # | Feature | iOS | Android | Verdict |
|---|---|---|---|---|
| 11 | Background tap → universal link → clock in | live (`onOpenURL` + `onContinueUserActivity`) | live (App Link + `NfcTapActivity` fallback) | PARITY |
| 12 | In-app manual scan fallback for a WORKER | **none** — removed for App Store error 90778 | `ScanActivity.kt` | **iOS GAP** — was blocked by the missing NFC entitlement; that entitlement is now present in the worktree (see §1.6) so the block is gone |
| 13 | Shift posted at clock-IN, server authoritative (decision-19) | live | live | PARITY |
| 14 | 8h auto-close + mandatory resolver (decision-10) | `ResolveSheet` | resolve dialog | PARITY |
| 15 | Offline queue, retry, blocked-row marking | SwiftData `Shift` | SQLite `shifts` | PARITY |
| 16 | `X-Pending-Shifts` / `-Blocked` / `-Oldest` headers (TASK-225) | **not sent, not read** | sent on every request | **iOS GAP** — the office's "this phone is still holding N" counter is Android-only |
| 17 | In-shift takeover / switch notice card | live (`switchNotice`, `ContentView.swift:~110`) | live | PARITY |
| 18 | Out-of-app running-shift signal | Live Activity + Dynamic Island | ongoing notification w/ `setUsesChronometer` (decision-27: no foreground service) | **N/A-PLATFORM** — each is the platform's own idiom; neither is portable |
| 19 | Reminder ladder + app-icon badge | `ShiftSignalCenter.swift` | `AlarmManager` ladder | PARITY |
| 20 | Worker sees their own hours FROM THE SERVER (`GET /shifts/mine`) | live, `API.swift:507` | **not called** — `HistoryScreen` reads local SQLite only | **ANDROID GAP** — TASK-189. A local History tab exists and is easy to mistake for this |
| 21 | Local shift history screen | `HistoryView` | `HistoryScreen` | PARITY |
| 22 | Material requests (outbox, unseen badge, no push) | `Materials.swift` + `MaterialsView` | `MaterialScreen` | PARITY |
| 23 | Tab lock during a shift; Materials + Settings never hidden | pinned by `shift-signal-check.swift` | pinned by `android/checks` | PARITY |

### 1.3 Operator (tag mounting, decision-45/47/49)

| # | Feature | iOS | Android | Verdict |
|---|---|---|---|---|
| 24 | Operator sign-in (`POST /auth/operator-code`) | `OperatorSignInScreen.swift`, a dedicated screen | inline field duplicated inside `WriteTagActivity` **and** `VerifyZoneActivity` | PARITY in function, **DIVERGED in shape** — decision-49 asked for a clause-for-clause port and the UI shapes are not the same. Pick a canonical shape (§6, TASK-Z) |
| 25 | Tag writing (`NdefTag` + `WriteGuard` + writer) | code-complete, verified three ways, hardware test outstanding (TASK-246 AC7) | live in the field | **iOS GAP, closing** |
| 26 | Zone test-scan (`POST /operator/zones/:id/verify`) | `VerifyZoneScreen.swift` | `VerifyZoneActivity.kt` | **iOS GAP, closing** (same AC7) |
| 27 | Operator zone cache for a stairwell | `OperatorZoneCache.swift` | `OperatorZoneCache.kt` | PARITY |
| 28 | Written-but-unreported tag survives process death | **none** — `report` is `@State` in `WriteTagScreen.swift:21`; swipe the app away and the office is never told a card exists | `PendingTagReport.kt`, persisted | **iOS GAP** |
| 29 | Operator cookie physically separated from the worker cookie | **NOT separated** — `OperatorAPI.swift:19-24` states outright it uses `URLSession.shared` and `HTTPCookieStorage.shared`; both cookies are `Path=/` on the same host (`server/lib/auth.js:211`), so **every** iOS request to `API.base` carries `ts_worker` *and* `ts_operator` together | separated: own `CookieJar`, own `Api`, own `operator-session` prefs file | **iOS GAP vs decision-49's literal wording.** The iOS wall is real but is made of two *other* things — a separate response choke point (no `.sessionRejected` post) and server-side route gating. See §2.3 |

### 1.4 Delivery and platform plumbing

| # | Feature | iOS | Android | Verdict |
|---|---|---|---|---|
| 30 | Self-update from inside the app | impossible | live and complete: `UpdateManager.kt` → DownloadManager → SHA-256 verify → `PackageInstaller`, resumable across process death | **N/A-PLATFORM** — App Store guideline 2.5.2 bans downloaded executable code. iOS's only counterpart is the passive sentence at `API.swift:189`, "This app version was rejected by the server. Update it." Research is filed: TASK-52, TASK-53 |
| 31 | Version check against the server (`GET /app/version`) | **not called at all** | called silently at every launch, survives a dead session | **iOS GAP** — a *check* is not an *updater*; row 30's platform wall does not excuse row 31. iOS cannot even tell a worker a fix exists |
| 32 | Two-host split: `tagHost` parsed, `apiHost` talked to (decision-40) | **single host.** `API.swift:27` derives the API base from `TagLink.host` = `Branding.tagHost`; `Branding.swift:29` fallback is `schimmer-glanz.exe.xyz`; the entitlement names the same. `node ops/check-branding.mjs` prints the TODO today | correct and Gradle-enforced (an unresolved placeholder fails the build) | **iOS GAP** — TASK-188. The last unmigrated corner of decision-40 |
| 33 | On-device DATA migration runner + receipt | `DataMigrations.swift` / `MigrationCore.swift` / `MigrationReceiptView.swift` | plain `SQLiteOpenHelper.onUpgrade()`, additive `ALTER TABLE`, no archive, no receipt | **N/A-PLATFORM** by choice of persistence layer, not by OS constraint. §4 removes its Settings entry; §5 reuses its runner |
| 34 | Sentry + PII scrub | `Telemetry.swift` + `Scrub.swift` | equivalent | PARITY ⚠ — `SENTRY_DSN` is unset in production (TASK-44/TASK-224), so both are blind |
| 35 | de/en localisation | `Localizable.xcstrings`, 112 keys ⚠ **0 use plural variations** | `strings.xml` de/en | PARITY ⚠ — TASK-40, and §5 makes it a blocker |
| 36 | Runnable logic checks outside the IDE | `NFCTimeSheets/checks/run.sh`, 9 checks | `android/checks` | PARITY ⚠ — **no check anywhere touches `Auth.swift`, `SignInView`, `SettingsView`, `OperatorSession.swift`, or the SwiftData half of `DataMigrations.swift`.** Everything §2–§5 adds is first-of-its-kind in that directory |

### 1.5 Gap totals

```
iOS GAP        rows 2 3 4 10 12 16 25 26 28 29 31 32   → 12
ANDROID GAP    row  20                                 →  1
BOTH + SERVER  row  9                                  →  1
N/A-PLATFORM   rows 1 7 8 18 30 33                     →  6
```

### 1.6 One measured surprise, uncommitted

`git status` shows `NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements` **modified in the
working tree and not committed.** The diff adds

```
com.apple.developer.nfc.readersession.formats = ["TAG"]
```

i.e. **TASK-246 AC6 — the owner's one Xcode click — appears to have already happened
locally.** It is not in any commit. Two consequences, both actionable and neither done here:

- AC6 cannot be marked done from a dirty worktree. Someone has to commit that file (owner's
  call — decision-49 says no agent edits the entitlement) or the next `git checkout` silently
  reverts the capability and the write screen degrades back to words.
- With `TAG` present, matrix row 12 (worker manual scan) stops being blocked by entitlements.

---

## 2 · iOS phone login — file-level plan

### 2.1 The recommendation on Sign in with Apple, stated plainly

**KEEP IT, VISIBLE, as a fallback in the release that adds phone login. Remove it in a LATER
release, behind three named gates.** Not hidden.

Why not remove now — this is the load-bearing argument and it is not about Apple's rules:

```
TASK-244 AC4 is still open  ∴ no admin UI exists to put a phone on a worker
∴ today the only way to give a worker a login phone is PUT /admin/workers/:id/phone by curl
∴ an iOS worker whose session expires (90d) after SIWA is removed has NO door at all
```

Removing SIWA in the same build that introduces phone login converts a 90-day cookie expiry
into a lockout with a manual, undocumented, owner-only recovery path. §5's wipe makes it
worse: the wipe *forces* the re-login for everyone at once.

Why not hidden: a fallback nobody can find is not a fallback. It keeps the
`com.apple.developer.applesignin` entitlement, keeps the `AuthenticationServices` import,
keeps `IneligibleView`'s whole branch alive — and buys nothing, because the one person who
needs it is locked out and cannot reach it.

Why removal is legitimate *later*: App Store guideline 4.8 requires Sign in with Apple only
where a **third-party or social** login is offered. Phone + OTP against our own server is a
first-party account system, so 4.8 does not apply. Removal is a product decision, not a
review risk.

The three gates for a later removal, all three required:

1. TASK-244 AC4 shipped — an admin can set a worker's login phone from the panel.
2. Every `active` worker has a `phone_identities` row (a one-line SQL check, evidence not
   assertion).
3. An owner-accepted decision record. decision-26 already conditioned exactly this move:
   *"enrolment codes can become the single mechanism on both platforms and decision-22's
   Apple flow retires to 'one way to get a session'. **Do not do that while the iOS pilot is
   running.**"* Nothing in this repo says whether the pilot is still running — that is an
   owner question (§7).

### 2.2 What the screen becomes

Mirror Android's composition rule exactly: **doors are added beside each other, never
instead of each other**, and the SMS section is drawn only when the server says SMS exists.

```
SignInView (signed-out)
├─ phone + OTP        drawn only if GET /auth/capabilities → {sms:true}   ← requirement (1)
├─ enrolment code     ALWAYS drawn                                         ← closes matrix row 2
├─ Sign in with Apple ALWAYS drawn, below, labelled as the existing way    ← the fallback
└─ pending-shift card if any local row is unsent                           ← closes matrix row 10
```

The enrolment-code field is in scope even though the owner only asked for phone login, and
the reason is structural, not tidiness: decision-48 §5 makes the code the guaranteed fallback
for every SMS failure mode, including `sms_not_configured`. If iOS ships SMS with no code
field, then the day Twilio's credentials lapse iOS has **one** door (Apple) and the plan in
§2.1 to retire Apple can never be executed. It is one `TextField`, one call, and
`EnrolmentCode.swift` — a pure Crockford base32 normaliser already in the tree from TASK-246
— is reused verbatim with no changes.

### 2.3 Why the worker session must NOT be built on `OperatorSession.swift`

One line, as asked: **`OperatorAPI.swift` deliberately runs its own response choke point that
never posts `.sessionRejected`, precisely so an expired operator code cannot sign a worker
out mid-shift — a worker door hung off that choke point would inherit the silence and a dead
`ts_worker` cookie would stop dropping the app to signed-out.**

The correction to the received wisdom, because it changes what "the wall" is on iOS: the
operator session is **not** a separate cookie jar or a separate `URLSession` on iOS.
`OperatorAPI.swift:19-24` says so itself, and both cookies are `Path=/` on one host
(`server/lib/auth.js:211`), so URLSession sends both on every request. decision-49's phrase
*"no request ever carries `ts_worker` and `ts_operator` together"* is true on Android and
false on iOS. The iOS wall is (a) the separate choke point above and (b) server-side route
gating, which reads cookies **by name** (`readCookie(headers, name)`) and never accepts a
`ts_operator` on a shift route. That is a genuine wall; it is just not the one the decision
describes. Filed as TASK-Y in §6 — do not "fix" it inside the login work.

### 2.4 Files to add

| File | What it holds | Notes |
|---|---|---|
| `NFCTimeSheets/NFCTimeSheets/WorkerSignInScreen.swift` | **NEW.** `SignInView` moved out of `ContentView.swift:104-141`, plus `PhoneSignInSection`, `CodeSignInSection`, and a private `signInErrorText(_:)` mapper | Name mirrors `OperatorSignInScreen.swift`. `ContentView.swift`'s `case .signedOut(let reason): SignInView(reason: reason)` is unchanged |
| `NFCTimeSheets/NFCTimeSheets/PhoneNumber.swift` | **NEW.** Foundation-only mirror of `server/lib/validate.js:162-187` `identityPhone()` | Same contract `EnrolmentCode.swift` states in its own header: **never more permissive than the server**, never a security control, exists only so the button can be disabled and so a fat-fingered number does not spend one of 3 OTP requests per rolling hour |
| `NFCTimeSheets/checks/phone-number-check.swift` | **NEW.** Vectors derived from `validate.js`, not from the Swift | Must cover: `0664 123 4567` → `+436641234567`; `0043…` → `+43…`; `+43 664/123-4567` → `+436641234567`; bare `6641234567` → **refused** (decision-45 §4 refuses to guess a country); a pasted name → refused; `>15` digits → refused |

`checks/run.sh` gains one line:
`run phone-number-check "$SRC/PhoneNumber.swift"`.

### 2.5 Files to change

**`API.swift`**

- `AuthAPI` (currently 423-443) gains four calls, each with the doc-comment discipline the
  file already uses — status codes spelled out so they can be diffed by eye against
  `server/routes/auth.js`:
  - `capabilities() -> WireCapabilities` — `GET /auth/capabilities`, `{sms:Bool}`, `auth:"app"`, no session.
  - `signIn(code:) -> WireSession` — `POST /auth/code`, 200 · 401 `invalid_code` · 429.
  - `smsRequest(phone:)` — `POST /auth/sms/request`, **202** · 422 `invalid_phone` · 429 · 503 `sms_not_configured`. Returns `Void`; the 202 body carries nothing a client may act on and must not be modelled as if it did.
  - `smsVerify(phone:code:) -> WireSession` — `POST /auth/sms/verify`, 200 (byte-identical to `/auth/code`'s) · 401 `invalid_code` · 429 · 503.
- New wire types beside the existing ones: `WireCapabilities`, `CodeSignInRequest`,
  `SmsRequestRequest`, `SmsVerifyRequest` — explicit `CodingKeys`, snake_case, per the file
  header's standing rule. Do **not** add `.convertToSnakeCase`.
- `APIFailure.workerMessage` (166-204) gains `sms_not_configured` and `invalid_phone`.
  **`invalid_code` must NOT be routed through `workerMessage`.** Android forked exactly these
  two strings on purpose (`TimeSheetApp.kt:395-412`, `smsErrorText` at `:405`): the shared mapper's advice for a bad
  *enrolment* code is "ask your admin for a new one", which is wrong for an OTP that the
  worker re-requests themselves. `signInErrorText(_:)` in the new screen file is the fork.

**`Auth.swift`**

- `Session` gains `private(set) var smsAvailable = false`, loaded once from
  `AuthAPI.capabilities()` and **fail-closed**: any throw, any offline, any old server leaves
  it `false` and the phone section is not drawn. Same rule as Android
  (`TimeSheetViewModel.kt:121`). A section that renders itself as a greyed-out "unavailable"
  is still a section, and decision-48 §6 forbids that.
- Three new methods — `signIn(code:)`, `requestSmsCode(phone:)`, `verifySmsCode(phone:code:)`
  — **all three ending in the existing `store(_ session: WireSession)` at `Auth.swift:245`**,
  which is what makes the worker identity come from the session and nothing else
  (decision-22). This is Android's documented convergence guarantee and it must be the same
  one line here, not a copy.
- `Session.State` gains **no** case. `signedOut(reason:)`, `eligible`, `ineligible` still
  cover everything. Per-field failures (`phoneFailure`, `codeFailure`) live as `@State` in
  the screen, exactly as Android keeps them in the composable — pushing them into the shared
  `reason` would make one field's error appear under another.
- `restore()` (92-110) gains the capability fetch. It must be **concurrent with, or after**,
  the existing work and must never lengthen the launch spinner's critical path — clocking in
  in a basement is the thing this file exists to protect.

**`ContentView.swift`**

- Lines 104-141 (`SignInView`) move out to the new file. `ContentView` itself changes by zero
  lines. Do not touch `IneligibleView` (159-224); it stays as long as SIWA stays.

**`Localizable.xcstrings`** — new keys for the phone label, hint, send/sending, OTP label,
hint, verify/verifying, "use a different number", the no-code-arrived sentence from §3, and
the code-field strings. German is the default language (decision-8) and it is what real users
see. Any string with a count uses a **plural variation**, not a Swift-side suffix — see
TASK-40 and §4.3.

### 2.6 Sequencing inside the release

```
1  decisions 45 + 48 formally accepted by the owner            ← governance, blocks everything
2  TASK-244 AC4 (admin can set a login phone in the panel)     ← otherwise nothing is testable
3  PhoneNumber.swift + its check                               ← pure, no UI, mergeable alone
4  API.swift AuthAPI + wire types                              ← pure wire, no UI
5  Auth.swift session doors (code, sms request, sms verify)
6  WorkerSignInScreen.swift, three doors composed
7  §3's copy on BOTH platforms
8  §4's Settings removal
9  §5's wipe migration                                          ← last, and only with 1-8 in
10 owner: TestFlight build + real-handset test (TASK-41)
```

Steps 3-6 are pure iOS and touch **no server file**. That is the point: `/auth/sms/*`,
`/auth/code` and `/auth/capabilities` are already deployed and already generic — the same
property that let TASK-246 port the operator flow with zero server changes.

---

## 3 · The unregistered phone — the conflict, named

### 3.1 The conflict

```
owner requirement (2)   an unregistered phone MUST be told to contact its administrator
decision-48 §6.3/6.4    202 {status:"accepted"} is BYTE-IDENTICAL for known and unknown,
                        and 401 {error:"invalid_code"} is BYTE-IDENTICAL for
                        unknown-number / wrong / expired / consumed / attempts-exhausted
                        / deactivated-worker
∴ these cannot both be true as literally stated
```

The server has no status code, no field and no distinguishable byte that means "you are not
on our roster". This is deliberate, documented in the route's own comments
(`server/routes/auth.js:377-403`), and it goes further than the response body: the per-phone
limiter *counts unknown numbers too*, specifically so a number that starts answering 429
cannot confirm it is on file.

What a real unregistered person experiences today on Android, measured not assumed: they type
their number, get walked straight to a 6-digit code field (`sentTo = phone`), wait for an SMS
that was never sent, guess, and read

> *"Der Code wurde nicht angenommen. Bitte erneut eingeben, oder fordern Sie einen neuen an."*
> — `strings.xml:54`

**That is worse than silence.** It is actionable-sounding and wrong: it tells someone who was
never onboarded to retry and request another code, forever, with no path to "call the office".

### 3.2 What was considered and refused

**Refused — reveal on request.** `POST /auth/sms/request` answering `200 {sent:true}` vs
`404 {error:"not_registered"}`. Anyone holding the app key — which `strings` recovers from any
installed binary, and `API.swift:29-52` says so out loud — could then probe any Austrian
number. Maximum leak for no extra honesty over §3.4.

**Refused — SMS the unknown numbers too.** Send "this number is not registered with
<company>, ask your administrator" to *every* requested number. Superficially perfect: the
message reaches only the handset that owns the number, so the HTTP API leaks nothing at all.
It is refused because it converts the login endpoint into a **denial-of-service on the
company's own workers**: the global spend cap is 20 SMS per rolling hour
(`lib/auth.js:425-428`), so ~20 junk numbers per hour exhaust the budget and a real cleaner
standing at a door cannot get their code. It is also a 3-messages-per-hour harassment vector
against any number a stranger types. A login path that a stranger can switch off is not a
login path.

**Refused — reveal after N failed attempts.** No `otp_challenges` row is written for an
unknown number at all — the `INSERT` is inside `if (target)` — so there is nothing to count.
Building it needs either decoy rows for unknown numbers (destroying the "unknown numbers cost
nothing" property the limiter design rests on) or a whole new ledger. More surface, softer
version of the same leak.

### 3.3 Why decision-22's precedent does NOT transfer cleanly

It is tempting to cite `IneligibleView` — this codebase already chose honesty over
enumeration-safety once, echoing back the exact Hide-My-Email address (`IneligibleView`,
`ContentView.swift:159`). The analogy breaks on
one fact: **by the time `POST /auth/apple` answers 403, Apple has already verified that the
caller owns that identity.** There is no stranger to protect. A bare phone number typed into
a text field proves nothing at all: the person asking about `+43664…` may be its owner, or
may be anyone who wants to know whether that person cleans buildings for this company.
Different threat, so the precedent informs but does not decide.

### 3.4 RECOMMENDED — Option C, honest copy, zero server change

Say the true thing to **everyone**, at the moment it becomes relevant, so the message
discloses nothing by being shown:

On the OTP screen, permanently visible under the code field (not only after a failure):

> **DE** — "Keine SMS erhalten? Möglicherweise ist Ihre Nummer bei uns noch nicht
> hinterlegt. Bitte wenden Sie sich an Ihre Verwaltung — sie kann Ihre Nummer eintragen oder
> Ihnen einen Anmeldecode geben."
> **EN** — "No SMS? Your number may not be on file yet. Ask your administrator — they can add
> it, or give you a sign-in code."

And `sms_invalid_code` (`strings.xml:54`) gains the second half of the advice instead of
stopping at "retry".

This is not a compromise dressed up as a design. It is **more correct advice than a
distinguishing message would be**, for three reasons:

1. It is right for the unregistered person: contact your administrator.
2. It is *equally* right for a registered worker whose SMS failed — a carrier rejection, a
   wrong number on file, Twilio down. Their answer is also "contact your administrator", who
   can read `sms_last_status` / `sms_last_reason` in the panel and, per decision-48 §5,
   **always already has a working enrolment code on screen**. A `not_registered` message
   would have told this person nothing, because they *are* registered.
3. It costs zero enumeration, zero server change, zero decision reversal, and it names the
   enrolment code as the escape hatch, which is exactly the role decision-48 §5 gives it.

**Where it does not satisfy the letter of the requirement, stated plainly:** it does not show
a *different* message to an unregistered phone. Both people see the same words. If the owner
means literally "different message", C is not it — go to §3.5.

Changes: **server 0 files.** Client: `Localizable.xcstrings` (iOS, new keys) and
`strings.xml` de + en (Android, one new key + one reworded key). Android also needs the
sentence rendered under the OTP field in `SmsSignInSection` — a `Text`, not a failure branch.

### 3.5 IF the owner wants literal distinguishability — decision-50

Next free decision id is **50** (49 is the highest that exists).

> **decision-50 — "A worker's own phone number is not a secret from the worker holding it:
> `/auth/sms/verify` may say `not_registered`." AMENDS decision-48 §6.4.**

Shape:

- `POST /auth/sms/request` — **unchanged.** Still `202`, still byte-identical, still spends
  the per-phone limiter for unknown numbers. The send side never becomes an oracle.
- `POST /auth/sms/verify` — after `checkGlobalOtpVerifyRate()` and the per-IP
  `smsotp:` bucket, and only when the phone parses, a lookup that finds **no
  `phone_identities` row joined to an active worker** answers a new
  `404 {error:"not_registered"}`. Everything else — wrong code, expired, consumed, attempts
  exhausted, deactivated worker — keeps the existing `401 invalid_code`, byte for byte.
- The oracle this opens, stated honestly so the owner is signing something true: one
  `POST /auth/sms/verify` with any 6 digits reveals whether a given number belongs to an
  active worker. Bounded by 60 verifies/min process-wide and the per-IP bucket. The real-world
  worst case is a stranger learning that one specific person does or does not clean for this
  company. Roster size ~20, closed B2B, not a consumer app.
- Server files: `server/routes/auth.js` `smsVerify` (~10 lines, in the `row === null` branch,
  *before* `recordLoginFailure`); a pin in `server/check-api.js` asserting that
  `/auth/sms/request` still cannot return anything but 202/422/429/503; the route's own
  doc-comment rewritten, because it currently asserts the opposite.
- Client files: iOS `signInErrorText`, Android `smsErrorText` + one `strings.xml` key each.
- **§3.4's copy ships anyway and is not replaced by this.** The registered-but-SMS-failed
  person still needs it.

Do not start §3.5's code before decision-50 is `accepted`. That is the whole point of §0.

---

## 4 · Settings cleanup

### 4.1 The exact removal

`NFCTimeSheets/NFCTimeSheets/ContentView.swift` — delete **lines 708-717**, the whole
`Section` including its comment and its footer:

```
708    // Not a flash-and-gone. A worker who dismissed the receipt at 06:00 at a
709    // door can find out later what was cleared off their phone and why.
710    Section {
711        NavigationLink("Migration history") {
712            MigrationHistoryView()
713        }
714    } footer: {
715        Text("Records an app update archived or flagged on this phone.")
716            .font(.footnote)
717    }
```

Deleting only the `NavigationLink` (711-713) leaves an empty `Section` that still renders as
a grey band with a footer explaining a row that is no longer there. Take the whole block.

Settings then reads: *Signed in as* → admin note → *Operator sign-in* → *Sign out*. Four
groups, down from five. That is one entry more than Android's identity group and one fewer
than Android's six (Android additionally has push diagnostics and self-update, neither of
which iOS can have — matrix rows 18 and 30).

### 4.2 What becomes dead, and what must stay

| Symbol | File | After the removal |
|---|---|---|
| `MigrationHistoryView` | `MigrationReceiptView.swift:71-84` | **fully dead — delete it.** Its only reference is `ContentView.swift:712` |
| `"Migration history"`, `"Records an app update…"`, `"Nothing has been archived on this phone."` | `Localizable.xcstrings` | dead — remove, or Xcode marks them stale |
| `MigrationRow` | `MigrationReceiptView.swift:86-107` | **STAYS** — shared with `MigrationReceiptSheet` (`private extension ArchivedShift` follows at `:109`) |
| `MigrationReceiptSheet` | `MigrationReceiptView.swift:19-68` | **STAYS** — still presented from `ContentView.swift:93-94` |
| `MigrationReceipt.unseen` / `.archived()` | `DataMigrations.swift:299-316` | **STAYS** — `archived()` feeds the receipt sheet at `ContentView.swift:90`, and §5's wipe needs both |
| `MigrationArchive`, `writeArchive`, `LegacyShiftArchive`, `ArchivedShift` | `DataMigrations.swift:260-295`, `MigrationCore.swift` | **STAY** — this is the archive-then-delete mechanism §5 is built on |
| `MigrationRunner`, `DataMigrations.all` | `MigrationCore.swift:29-63`, `DataMigrations.swift:49` | **STAY** — §5 appends to `all` |

So: **one view and three strings die. The mechanism is untouched.** The receipt still appears
after a migration; only the permanent browsable log leaves. That is the right cut — the
receipt is a one-time explanation a worker needs; the history list was a developer's audit
trail wearing a worker's clothes.

### 4.3 Two things this removal does NOT do

- **It does not close TASK-40.** The `4 alte Schichts` plural bug lives at
  `MigrationReceiptView.swift:35` and `:48`, inside `MigrationReceiptSheet`, which survives.
  §5 makes TASK-40 a **blocker**, not a nicety: after a total wipe, the receipt is the only
  screen explaining where a worker's history went, and broken German on that screen is the
  worst possible place for it.
- **It has no Android counterpart.** Android never had this entry and never could — its
  stores use additive `SQLiteOpenHelper.onUpgrade()` with no archive step and no receipt UI.
  Matrix row 33.

---

## 5 · The one-time local data wipe

### 5.1 Recommendation: a new `DataMigration(version: 2)`. Confirmed, not assumed.

The hypothesis in the brief was that the migration runner is the right mechanism rather than
a parallel bolt-on. Having read it: **confirmed.** Appending one step to
`DataMigrations.all` inherits five properties a bolt-on would have to reimplement, and
`MigrationCore.swift`'s header states all five as the contract:

```
runs exactly once, ever   ← ts.dataMigrationVersion watermark in UserDefaults
ordered, append-only      ← a worker who skipped a version still runs 1 then 2
idempotent under a kill   ← version advances only AFTER context.save() returns
archive → verify → delete ← writeArchive() re-READS before anything is deleted
already before the UI     ← NFCTimeSheetsApp.swift:132-135 runs it BEFORE session.restore(),
                            while ContentView renders a spinner and no @Query is on screen
```

That last line is why the wipe rides here and nowhere else. `runPending` is already the only
code in the app that executes **between the container opening and the session resolving** —
exactly the window in which "erase everything, then make them sign in" is a single coherent
act rather than a race against a rendering shift list.

And the sequencing is free: land it in the same release as §2's phone login, and the forced
re-login is not an extra insult — it is the release's headline feature, with three doors
waiting on the other side of it.

### 5.2 Four mismatches found, each needing an explicit answer

**(a) A wipe on an empty phone would say nothing.** `DataMigrations.swift:94` only sets
`MigrationReceipt.unseen` `for outcome in outcomes where outcome.touchedAnything`, and
`touchedAnything` is `archived + deleted + keptBlocked + reconciled > 0`. A phone with no
rows gets no receipt — yet that is precisely the phone whose worker is about to be signed out
for no visible reason. The wipe step needs to announce itself unconditionally. Cheapest
honest fix: a `var announces = false` on `MigrationOutcome` that the wipe sets, OR'd into the
`touchedAnything` gate. Do not silently reuse the existing behaviour.

**(b) The wipe must never wait on the network.** `serverShiftsIfNeeded`
(`DataMigrations.swift:114-138`) only fetches when the classifier returns `.reconcile`. The
wipe step needs no server data, so it must **not** be wired into that gate. A wipe that waits
out a URLSession timeout puts that timeout in the launch spinner of every phone in the
company, once, on the same morning.

**(c) The step signature is honest about being SwiftData-only, and a wipe breaks that.**
`run: (ModelContext, [String: WireShift]) throws -> MigrationOutcome` declares its inputs, but
`UserDefaults`, Application Support files (`material-requests.json`,
`ts-migration-archive-v1.json`, `operator.zones.json`) and `HTTPCookieStorage` all sit outside
them. Nothing *stops* the closure calling `FileManager` directly — but `MigrationOutcome`
cannot report what it did. Recommendation: **accept it, extend `MigrationOutcome`, and keep
one mechanism** rather than growing a second one-shot beside it. The order is not negotiable:
archive → verify → non-SwiftData wipe → SwiftData delete → `save()` → version advances.

**(d) The archive is itself local data — this is the contradiction and it needs a ruling.**
`DataMigrations.swift`'s own header: *"NOTHING IS DESTROYED WITHOUT BEING RECOVERABLE
FIRST."* A wipe that also erases `ts-migration-archive-v*.json` erases the recovery copy and
breaks the file's stated invariant. Recommended reading of "erase everything": **erase every
local row, identity, cache and cookie, and keep ONLY the shift archive.** Nothing else in the
inventory has anything to recover — a roster cache re-fetches, a notification flag is a
boolean, a zone cache re-fetches.

### 5.3 The inventory the step must cover

| What | Where | Wipe? |
|---|---|---|
| `Shift` rows (incl. **unsent, unpaid hours**) | SwiftData | archive first — see §5.5 |
| `Site` roster cache | SwiftData | yes, no archive (re-fetched from `GET /roster`) |
| `session.workerId` / `.workerName` / `.appleUserId` | UserDefaults | yes |
| `operator.id` / `operator.name` | UserDefaults | **owner's call** — an operator's phone may be a different person's |
| `signalHasClockedIn` / `signalAskedForNotifications` | UserDefaults | yes (re-asks for notification permission once) |
| `ts.migration.receiptUnseen` | UserDefaults | no — the wipe *sets* it |
| `ts.dataMigrationVersion` | UserDefaults | **never** — it is the watermark that stops the wipe running twice |
| `material-requests.json` | Application Support | yes — but it holds unsent worker words; same rule as §5.5 |
| `operator.zones.json` | Application Support | yes, no archive (re-fetched) |
| `ts-migration-archive-v*.json` | Application Support | **no** — §5.2(d) |
| `ts_worker` cookie | `HTTPCookieStorage` | yes — this is what forces the re-login |
| `ts_operator` cookie | `HTTPCookieStorage` | **owner's call**, same as the operator defaults above |
| Keychain | — | nothing to wipe. `Auth.swift:59` and `DataMigrations.swift:11` both state this app puts nothing there |

### 5.4 THE QUESTION THE OWNER MUST ANSWER FIRST

**Does "erase everything" include ending the SERVER-side `worker_sessions` row, or only local
device state?**

The codebase already has an answer to the general version of this question and the wipe should
simply call it. `Session.signOut()` (`Auth.swift:227-232`) is documented as *revoke
server-side first, then drop everything locally even if that call failed* — chosen so a stolen
phone cannot keep the cookie alive. Reusing it makes the wipe's behaviour identical to a
sign-out the worker performed themselves, which is one behaviour to explain instead of two.
(`signOut()` is at `Auth.swift:227`; the local half it calls, `clearLocalSession()`, is what
deletes every cookie for `API.base`.)

That narrows the owner's decision to the offline case, which is real: iOS launches in
stairwells.

| | Server row | Verdict |
|---|---|---|
| Wipe online | `POST /auth/logout` lands, row deleted | clean |
| Wipe offline | logout throws, **row survives up to 90 days** | needs a ruling |

Options for the offline case:

1. **Accept it (RECOMMENDED).** The cookie is gone from the phone, so nobody can use that
   session; the row expires on its own TTL. This is exactly what `signOut()` already does
   today, so it introduces no new behaviour and no new failure mode.
2. Queue a retry — **impossible.** The bearer token lived only in the cookie, and the wipe
   deleted it. There is nothing left to authenticate a later logout with.
3. Require network before wiping — **refused.** A wipe that cannot run without signal is a
   wipe that never runs on the phone that most needs it, and it would block the app's launch.

Related, and worth deciding in the same breath: a device backup restored from *before* the
wipe can resurrect the cookie, because `HTTPCookieStorage` lives in the app container. Under
option 1 that restored cookie is valid until the 90-day TTL. Under a server-side revoke that
actually landed, it is dead on the next request. This is the only concrete argument for
caring about the offline case at all — and it argues for best-effort revoke, which is what
option 1 already does.

### 5.5 The one clause where the wipe can destroy money

`Shift` rows with `openSyncedAt == nil` are **hours worked that the server has never seen**.
TASK-225's rule is explicit and was designed for exactly this: *signing out does not delete a
queued shift.* A wipe that erases an unsent shift erases unpaid labour whose only copy was on
that phone.

**Recommendation: the wipe DEFERS while any unsynced row exists.** Return without advancing
the version, exactly as the existing `serverUnreachable` path does; the next launch retries.
Surface it in words — "There are still N shifts to send. Connect to the internet once and
this will finish by itself." One-time wipes and unpaid Tuesdays do not belong in the same
release note.

This is a strong recommendation, and it is the one clause the owner may reasonably override
("erase everything, one time" could genuinely mean *everything*). If overridden, the archive
step is not optional — those rows go into `ts-migration-archive-v2.json` first, verified by
re-read, before a single `context.delete`.

`material-requests.json` carries the same shape of risk in a smaller size: unsent words a
worker typed. Same rule.

### 5.6 What must be true before the wipe ships

```
✓ §2 phone login is in the SAME build          — three doors waiting after the forced logout
✓ TASK-244 AC4 shipped                          — an admin can actually put a phone on a worker
✓ TASK-40 fixed                                 — the receipt is now the ONLY explanation, in German
✓ matrix row 10 (pending card on the sign-out screen) — or a queued shift becomes invisible
✓ a new checks/wipe-migration-check.swift       — first check ever to touch this area (row 36)
✓ owner has answered §5.4 and §5.5
```

---

## 6 · Next iteration

Cross-checked against every open task on the board. Where work already has an id, the id is
referenced and only the **delta** is stated — no duplicates were created.

### 6.1 Already open — what changed

| Id | Status | Delta from this analysis |
|---|---|---|
| **TASK-244** | In Progress | AC4 (Login-Nummer editor in the panel) is promoted from "sizeable follow-up" to **hard blocker of the whole iOS phone-login line**. Without it there is no way to onboard the first iOS worker except curl — which is literally how the production SMS test was performed |
| **TASK-246** | In Progress | **AC6 may already be satisfied**: the NFC `TAG` entitlement is present in the working tree, uncommitted (§1.6). Needs the owner to commit it. AC7 (8-item hardware list) still outstanding |
| **TASK-188** | To Do | Independently re-verified: `API.swift:27` derives the API base from `TagLink.host`, `Branding.swift:29` fallback is the renameable host, `check-branding.mjs` prints the TODO. **Any new iOS network call — phone login included — rides the tag host until this ships.** Still owner-blocked on an Xcode build |
| **TASK-189** | To Do | Confirmed still real. Android's `HistoryScreen` reads local SQLite, **not** `GET /shifts/mine` — easy to mistake for done. Not touched by this iteration; keep it filed accurately |
| **TASK-215 / TASK-216** | To Do | Underlying `phone_identities` namespace is not closed: `POST /admin/workers` still accepts an operator's number. Phone login makes this a login-collision path, not just a data-hygiene one. TASK-216 remains blocked on the decision-41 ruling |
| **TASK-40** | To Do | Promoted from cosmetic to **blocker of §5**, because the receipt becomes the only explanation a wiped phone offers |
| **TASK-41** | To Do | This is how any of the above reaches a phone. Owner-only |
| **TASK-52 / TASK-53** | To Do | Research on store-independent delivery. Matrix row 30 is their real motivation, now measured |

### 6.2 New tasks

Every one names why it exists and what it waits on. None duplicates an id above.

**TASK-A · Accept or amend decision-45 and decision-48.**
*Why:* production is running on two `proposed` decisions, and this iteration adds a fourth
mechanism on top of them. *Depends on:* owner only. *Blocks:* everything else here.

**TASK-B · `PhoneNumber.swift` + `checks/phone-number-check.swift`.**
*Why:* a client-side shape check keeps a fat-fingered number from spending one of 3 OTP
requests per rolling hour, and the button cannot be sensibly disabled without it. Pure,
Foundation-only, mergeable alone. *Depends on:* nothing.

**TASK-C · `AuthAPI` gains capabilities / code / sms-request / sms-verify.**
*Why:* the wire half of phone login, diffable by eye against `server/routes/auth.js`. Zero
server change. *Depends on:* TASK-A.

**TASK-D · `Session` gains three doors, all landing in the existing `store(_:)`.**
*Why:* identity must keep coming from the session and never from a body (decision-22); one
convergence point is what guarantees it. *Depends on:* TASK-B, TASK-C.

**TASK-E · `WorkerSignInScreen.swift` — phone + code + Apple, composed.**
*Why:* requirement (1), plus matrix row 2, plus the fallback that lets §2.1's later SIWA
removal ever happen. *Depends on:* TASK-D.

**TASK-F · The unregistered-phone copy, both platforms (§3.4).**
*Why:* requirement (2), in the version that needs no server change and no decision reversal.
Fixes Android's actively-misleading `sms_invalid_code` at the same time. *Depends on:* TASK-E
for the iOS half; the Android half can ship immediately and independently.

**TASK-G · decision-50 + `not_registered` on `/auth/sms/verify`.** *Only if the owner wants
literal distinguishability.* *Why:* §3.5. *Depends on:* decision-50 being `accepted` — do not
start the code first.

**TASK-H · Remove Settings ▸ Migration history; delete `MigrationHistoryView`.**
*Why:* requirement (3). Small, self-contained, no dependency. *Depends on:* nothing.
*Must not regress:* `MigrationReceiptSheet` still presents from `ContentView.swift:93-94`.

**TASK-I · `DataMigration(version: 2)` — the one-time local wipe.**
*Why:* requirement (4). *Depends on:* TASK-E (a door to land on), TASK-40 (German on the
receipt), TASK-J (queued shifts stay visible), and the owner's answers to §5.4 and §5.5.

**TASK-J · Pending-shift card on the iOS signed-out screen.**
*Why:* matrix row 10. Android shows queued shifts on its sign-in screen so a phone handed back
does not look like it lost hours. After §5's forced logout, iOS shows nothing at all.
*Depends on:* TASK-E.

**TASK-K · iOS calls `GET /app/version`.**
*Why:* matrix row 31. iOS cannot self-update (row 30, platform wall) but it currently cannot
even *tell* a worker a fix exists. The route already exists, is `auth:"app"`, and deliberately
survives a dead session. Cheap. *Depends on:* nothing.

**TASK-L · iOS persists the written-but-unreported tag.**
*Why:* matrix row 28. `WriteTagScreen.swift:21` holds the report in `@State`; swiping the app
away after a successful write means the office is never told the card exists. Android solved
this with `PendingTagReport.kt`. *Depends on:* TASK-246 AC7.

**TASK-Y · Reconcile decision-49's cookie-jar clause with the iOS implementation.**
*Why:* §2.3 — decision-49 says no request carries `ts_worker` and `ts_operator` together;
`OperatorAPI.swift:19-24` and `server/lib/auth.js:211` together say every iOS request does.
Either the iOS jar is split to match Android, or the decision is amended to describe the wall
that actually exists (separate choke point + server-side route gating). **A decision that
misdescribes the code is worse than no decision.** *Depends on:* owner ruling.

**TASK-Z · Pick one canonical operator sign-in shape.**
*Why:* matrix row 24. iOS built a dedicated screen; Android duplicates an inline field in two
activities. decision-49 asked for a clause-for-clause port and the UI shapes diverged.
*Depends on:* nothing; low priority, but it decides whether Android grows a screen or iOS
folds inline before either is touched again.

### 6.3 Critical path

```
TASK-A ─┬─ TASK-244 AC4 ─────────────────────────────┐
        └─ TASK-B ─ TASK-C ─ TASK-D ─ TASK-E ─┬─ TASK-F(iOS) ─┐
                                              ├─ TASK-J ──────┤
                                              └───────────────┴─ TASK-I ─ TASK-41
TASK-H, TASK-K, TASK-F(Android)   independent, ship any time
TASK-G                            waits on decision-50
TASK-Y, TASK-Z, TASK-188, TASK-189   parallel, unblocked by the above
```

---

## 7 · Open questions for the owner

1. **Accept decision-45 and decision-48?** They are `proposed` and production runs on them.
2. **Is the iOS pilot still "running"?** decision-26 conditioned retiring Sign in with Apple
   on it no longer being. Nothing in the repo answers this.
3. **§3 — honest-copy-for-everyone (recommended, no server change) or a literal
   `not_registered` (decision-50, reverses a documented property of decision-48)?**
4. **§5.4 — does the wipe end the server-side session?** Recommended: reuse
   `Session.signOut()`'s existing revoke-then-drop order, best effort, accept that an offline
   wipe leaves the row to its 90-day TTL.
5. **§5.5 — may the wipe delete UNSENT shifts?** Recommended: no — defer until they are sent.
   This is the only clause where the wipe can destroy unpaid labour.
6. **§5.3 — does the wipe also clear the OPERATOR session on a shared phone?**
7. **Commit the NFC entitlement?** It is modified and uncommitted in the working tree (§1.6).
   decision-49 says no agent edits that file, so this is the owner's commit to make — and
   until it is made, a `git checkout` silently reverts the capability.
8. **TASK-244 AC4 priority.** Until an admin can set a login phone from the panel, iOS phone
   login is demonstrable but not deployable.
