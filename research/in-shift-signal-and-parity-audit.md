# In-shift signal, the lock, and iOS/Android parity — research and audit

Research only. No product code changed. Read `backlog/decisions/` before acting on any of it.

Audited against the working tree, not against a description of it. Every file:symbol below was
opened. OS capability claims are cited; where the only evidence is community reports and not
Apple/Google documentation, it says so.

---

## 0. The failure this whole piece of work exists to prevent

Worker taps in at 06:02, pockets the phone, cleans, goes home. Nothing on the phone ever
mentions the shift again. At 14:02 `nfc-autoclose.timer` fires, the row becomes
`auto_closed = true / corrected_at = NULL`, it leaves payroll (decision-10), the worker's single
open-shift slot (`shifts_one_open_per_worker_idx`) was burned all day, and the office pays for a
manual correction.

Everything below is measured against: *does this make that worker remember?*

---

## 1. Feature parity matrix

Legend for **Gap**: **GENUINE** = platform capability or an accepted decision forces the
difference. **MISSING** = nobody wrote it. **NONE** = at parity.

| # | Feature | iOS | Android | Gap |
|---|---------|-----|---------|-----|
| 1 | Identity / enrolment | Sign in with Apple. `ContentView.SignInView`, `Auth.swift Session`, `AuthAPI.signInWithApple`, entitlement `com.apple.developer.applesignin` | Enrolment code. `TimeSheetApp.SignInScreen`, `core/EnrolmentCode.normalise`, `Api.enrol`, `TimeSheetViewModel.signIn` | **GENUINE** — decision-26 chose this and forbids changing iOS mid-pilot |
| 2 | "Authenticated but not a worker" state | `SessionState.ineligible(email)` → `IneligibleView`, echoes the Hide-My-Email relay address | Does not exist and cannot: a redeemed code is a worker by construction | **GENUINE** |
| 3 | Session restore | `Session.restore()`; cached worker first, `GET /auth/session` second; network failure ≠ sign-out | `TimeSheetViewModel.restoreSession()`; identical ordering and identical rule | **NONE** |
| 4 | 401 handling | Single choke point `API.swift send()` posts `.sessionRejected` immediately on any 401 | `app.sessionRejected` flag, only *read* at the end of `refresh()` | **MISSING** (minor) — a 401 from a non-refresh path on Android sits until the next refresh |
| 5 | Tag dispatch | Background NFC → universal link. **Two** entry points: `onOpenURL` + `onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` in `NFCTimeSheetsApp.swift`. No CoreNFC entitlement | App Link `ACTION_VIEW` (Android 16+) → `MainActivity.handle`; `ACTION_NDEF_DISCOVERED` (≤15) → `NfcTapActivity` → `MainActivity` | **NONE** in effect |
| 6 | Tag-path health check | none | `nfc/NfcReadiness`: `UNSUPPORTED` / `DISABLED` / `TAG_INTENTS_BLOCKED` + banner + settings intents | **GENUINE** — iPhone has no user-facing NFC toggle and no tag-intent allowlist, so there is nothing to check |
| 7 | Duplicate-tap collapse | `TapInbox.swift`, 3 s window | `core/TapInbox.kt`, 3 s window | **NONE** — both pinned by a runnable check |
| 8 | Open / close / switch-building | `LogView.handleTap`; switch closes the old shift with `autoClosed = true` | `TimeSheetViewModel.handleTap` → `writeTap`; identical | **NONE** semantically |
| 9 | Switch-building notice | `alertMsg` **alert** — and the code notes SwiftUI silently drops one of alert-and-sheet, so a switch that coincides with unresolved shifts loses the resolver | dismissible `switchNotice` Card with `liveRegion = Assertive`, no collision possible | **MISSING** on iOS — Android's shape is the correct one |
| 10 | Local queue | SwiftData `Shift` + `syncPending` in `Sync.swift`; oldest-first, open-before-close | SQLite `data/ShiftStore` + **pure** `core/SyncPlan` executed by `data/ShiftSync`; same ordering | **MISSING** on iOS — the ordering/blocking/retry rules are inline and only partly check-covered; Android's are pure and fully covered by `android/checks` |
| 11 | Background retry | none. `ponytail` ceiling recorded in `Sync.swift`, upgrade path `BGAppRefreshTask` | none. Same ceiling recorded in `ShiftSync.kt`, upgrade path `WorkManager` | **NONE** — deliberately equal |
| 12 | Cross-account block | `pushOpen` guard `shift.workerId == workerId` → `syncBlocked` | `SyncPlan.plan(queue, sessionWorkerId)` → block | **NONE** |
| 13 | Server-authoritative open shift | `adoptServerOpenShift(context:)` | `ShiftSync.adoptServerOpenShift()` | **NONE** |
| 14 | Unresolved resolution (decision-10) | `ResolveSheet`: `DatePicker` (**date + time**), clamped range, all shifts in one Form, per-shift Save | `ResolveDialog`: `TimePicker` (**time of day only**), one shift at a time, anchored to the start date with a +1-day roll for night shifts | **MISSING** on Android — a real finish time more than one calendar day after the start is unrepresentable. Narrow: the 8 h cap puts nearly every real end inside the +1-day roll |
| 15 | Resolution progress ("1 of 3") | not shown | not shown | **MISSING both** — decision-10 point 3 asked for it |
| 16 | Resolution is dismissible | "Later" button | "Später" button | **NONE**, but both *deviate* from decision-10 point 3 ("No skip/dismiss"). Deliberate, reasoned in code comments, **not** recorded in any superseding decision. See risk R7 |
| 17 | History | `HistoryView`: week + total + all shifts + swipe-to-delete local rows | `HistoryScreen`: week + total + all shifts. No delete | **MISSING** on Android (minor; deleting is arguably a footgun) |
| 18 | Materials | `MaterialsView` + `MaterialStore.swift` + pure `Materials.swift`; tab `.badge(materials.unseenArrivalCount)`; started at launch | `MaterialScreen` + `data/MaterialStore.kt` + pure `core/MaterialQueue.kt`; `Badge` in `NavigationBar`; started at launch **and** on tab open | **NONE** |
| 19 | Materials 404 ("routes not deployed") | `not_found` → "saved and will be sent later", row kept | `featureUnavailable` flag + a sentence on the screen | **NONE** |
| 20 | "There is no push" told to the worker | comment only, not on screen | `R.string.material_no_push_note`, on screen, in words | **MISSING** on iOS |
| 21 | Error text | `APIFailure.workerMessage` — hardcoded English `switch` | `ApiFailure.messageKey` → `ui.stringIdFor` → string resources; key coverage asserted by `android/checks` | **MISSING** on iOS |
| 22 | Localisation (decision-8, decision-17) | **none.** No `.xcstrings`, no `.lproj`. English literals throughout; `ponytail` ceiling recorded in `API.swift` | `res/values/strings.xml` = **German** (default fallback), `res/values-en/strings.xml` = English, 106 strings each, key-set parity asserted | **MISSING** on iOS — the largest honest gap. Default language is German and the iOS app is the one in daily use by Austrian cleaners |
| 23 | Accessibility | `accessibilityLabel`, `.isHeader`, `AccessibilityNotification.Announcement`, spelled-out relay address, `ScrollView` for large type, `accessibilityElement(children: .combine)` | `semantics { heading() }`, `liveRegion` Assertive/Polite, `contentDescription`, `heightIn(min = 48.dp)` touch floors, `pluralStringResource`, `verticalScroll` for 200 % font | **NONE** overall, different idioms. **MISSING both**: no live-region announcement on the log screen (iOS), no touch-target floor asserted (iOS), no font-scale/Dynamic-Type check in either checks suite |
| 24 | Telemetry | Sentry via `Telemetry.swift`; **`Info.plist SentryDSN` is the empty string → telemetry is OFF on the shipped build** | none at all, by design; `android/checks` asserts the app has no logging | **GENUINE** (decision-23 names API + iOS only), but see risk R9/R10 |
| 25 | Legacy-data migration + receipt | `DataMigrations.swift`, `MigrationCore.swift`, `MigrationReceiptView` | none | **GENUINE** — Android has no legacy installs |
| 26 | Refresh | `.refreshable` pull-to-refresh | explicit `OutlinedButton` "Aktualisieren" | **NONE** (Android's is more discoverable with gloves on) |
| 27 | **In-shift signal** | orange `pill("In progress", .orange)` at `ContentView.swift:434`, plus an "In progress" `Section` header, plus the bottom hint flipping to "Hold your phone to the tag again to finish." All three are **in-app only** | `R.string.status_running` text label on the row, plus `R.string.log_hint_stop`. In-app only | **NONE — equally useless.** Neither platform puts anything outside the app. This is the work |

Correction to the brief: iOS has *three* weak in-app signals, not one. It does not matter — all
three are invisible unless the app is open, which it is not.

---

## 2. The in-shift signal, per platform: what the OS allows, and what it costs

### 2.1 iOS 18

**A. ActivityKit Live Activity + Dynamic Island — the strongest signal, and it needs the owner.**

- Requires a **widget extension target**. Apple: *"Create a widget extension if you haven't
  already added one to your project and make sure to select 'Include Live Activity'"* and *"The
  code that describes the user interface of your Live Activity is part of your app's widget
  extension."*
  ([Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities))
  → **`project.pbxproj` edit → owner only.** Agents deliver code + click-path, inert until then.
- Requires `NSSupportsLiveActivities = YES` in the **app target's** `Info.plist` (same doc).
  `NFCTimeSheets/Info.plist` is already wired via `INFOPLIST_FILE`, so **that key needs no
  project edit** and can be added now.
- **Starting requires the foreground.** Apple: *"you can only start a Live Activity while the app
  is in the foreground, unless you adopt App Intents and start the Live Activity using a
  `LiveActivityIntent`."* ([Activity](https://developer.apple.com/documentation/activitykit/activity))
  A tag tap opens the universal link, which foregrounds the app — so the tap path *is* a legal
  place to start one. No App Intents needed.
- **Hard 8-hour ceiling.** Apple: *"A Live Activity can be active for up to eight hours … After
  the eight-hour limit, the system automatically ends the Live Activity … the Live Activity
  remains on the Lock Screen … for a maximum of 12 hours."* This is **exactly** the auto-close
  window. A Live Activity can never outlive the 8 h timeout, and that is a feature, not a
  problem — but do not promise "it stays until you tap out".
- **The user can switch Live Activities off per app in Settings.** Check
  `ActivityAuthorizationInfo().areActivitiesEnabled` and degrade silently.
- **Survives force-quit and reboot.** The Live Activity is rendered by the system from the widget
  extension; the app process is not needed. *Evidence is community, not Apple documentation* —
  [SO 78652349](https://stackoverflow.com/questions/78652349/live-activity-is-still-running-after-iphone-is-rebooted),
  [r/iOSProgramming](https://www.reddit.com/r/iOSProgramming/comments/1dlxxov/live_activity_is_still_running_despite_iphone/).
  Treat as *likely true, must be verified on a real phone before it is promised to the owner.*
- **iOS 18 API surface only.** Use `Activity.request(attributes:content:pushType:)`. The
  `style:`, `startDate:` and `alertConfiguration:` overloads and `ActivityStyle.transient` are
  newer than iOS 18 — deployment target is 18.0, do not touch them.
- **The running timer is free.** `Text(timerInterval:)` inside the Live Activity is ticked by the
  system. No updates, no background execution, no battery, no network.

**B. App icon badge — the owner asked for "something on the HOME SCREEN". This is it.**

- `UNUserNotificationCenter.current().setBadgeCount(1)`. No new target, no new capability.
- Requires the `.badge` authorization option (Apple: *"Request permission to display alerts, play
  sounds, or badge the app's icon"*,
  [Asking permission to use notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)).
  Denied → no badge, nothing else breaks.
- Survives app kill and reboot: the badge is owned by SpringBoard, not by the app.
- **Collision to decide once:** the Materials *tab* badge (`ContentView.swift:49`) is a different
  thing and does not collide. But the *icon* badge can only carry one number. Rule: **an open
  shift owns the app-icon badge; materials never touch it.**
- Weakest signal in information terms (a dot, no words). Cheapest and most durable.

**C. Local notifications — the reminder ladder.**

- No new target, no new capability for `.active` / `.passive`.
- Repeating trigger: `UNTimeIntervalNotificationTrigger(timeInterval:repeats: true)` requires
  ≥ 60 s. **Prefer a ladder of one-shot requests** at +1 h … +8 h: distinct copy per rung
  ("Sie sind seit 5 Stunden eingestempelt"), and one `removePendingNotificationRequests` cancels
  the lot on tap-out.
- Ceiling: the system keeps only *"the soonest-firing 64 notifications … and discards the rest"*
  ([UILocalNotification](https://developer.apple.com/documentation/uikit/uilocalnotification), the
  documented statement of a limit that also governs `UNUserNotificationCenter`). An 8-rung ladder
  is nowhere near it.
- **`.timeSensitive` needs a capability.** WWDC21-10091: *"To configure Time Sensitive
  notifications, enable the associated capability via Xcode for your application."* → a project
  edit → **owner click-path, inert until then.** Set `.timeSensitive` anyway: without the
  capability it degrades to `.active`, which is what we would have used regardless.
- **`.critical` is out.** It needs `com.apple.developer.usernotifications.critical-alerts`, which
  Apple grants only on a request form, for medical/safety/security. A timesheet is none of those.
  Do not request it.
- Survives reboot and force-quit: pending requests are held by the system and fire with the app
  never launched.
- **Can be silently dropped:** Focus modes and Scheduled Summary can hold `.active` back.
  `.timeSensitive` breaks through Focus — but only with the capability.

**D. Refused on iOS.** Push (there is no APNs and decision-23 caps server deps at
`pg` + `@sentry/node`). Background execution as a timer (`BGAppRefreshTask` is opportunistic, not
a clock). Kiosk (Guided Access is user-initiated; Single App Mode is MDM-only).

### 2.2 Android

**A. An ongoing notification, and NO foreground service. This is the whole answer.**

- `NotificationCompat.Builder(...).setOngoing(true).setWhen(startMillis).setUsesChronometer(true)`
  on a channel of `IMPORTANCE_DEFAULT`. `setUsesChronometer` makes the **system** tick the
  elapsed time in the notification: no service, no wakelock, no battery.
- **A foreground service is not required to post a notification.** An FGS exists to keep a
  *process* alive. Nothing here needs a live process — the elapsed time is drawn by the system
  and the shift's truth is on the server.
- **Survives task-swipe and process death.** The notification is owned by `NotificationManager`,
  not by the app. This is strictly *better* than an FGS, which OEM battery managers kill.
- **"Non-dismissible" is a lie on Android 14+.** Google: *"If your app shows non-dismissable
  foreground notifications to users, Android 14 has changed the behavior to allow users to dismiss
  such notifications … The behavior of `FLAG_ONGOING_EVENT` has changed to make such notifications
  actually dismissable."* Still non-dismissible **when the phone is locked** and immune to *Clear
  all*. ([Android 14 behavior changes](https://developer.android.com/about/versions/14/behavior-changes-all))
  Promise "it is there on your lock screen", never "you cannot get rid of it".
- **`POST_NOTIFICATIONS` on Android 13+.** `minSdk 26`, `targetSdk 36` → version-gated runtime
  request. Denial must never touch the tap path.
- **Crucially, an FGS does not escape that permission.** Google's own wording is *"non-exempt
  (including Foreground Services (FGS)) notifications"* and *"Apps don't need to request the
  `POST_NOTIFICATIONS` permission in order to launch a foreground service. However, apps must
  include a notification …"*
  ([Notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)).
  So a foreground service buys **zero** additional visibility. That alone settles the question.
- **Reboot clears every notification.** Needs a `BOOT_COMPLETED` receiver +
  `RECEIVE_BOOT_COMPLETED` (a normal, install-time permission — no dialog) that reposts from the
  local SQLite open shift. ~20 lines, no network. Not delivered to a force-stopped app; name that.

**B. Foreground service — REJECTED, and record why.**

- No matching type exists. The nearest is `specialUse`, which needs the
  `FOREGROUND_SERVICE_SPECIAL_USE` permission **and** a `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`
  manifest property
  ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types)).
- Play then demands an App-content declaration with a description, a **demonstration video**, and
  a chosen use case, and *"All foreground service types are subject to review"*
  ([Play FGS requirements](https://support.google.com/googleplay/android-developer/answer/13392821)).
- On a personal Play account (decision-27) that is real review risk for a benefit of exactly zero.
- Any change adding `FOREGROUND_SERVICE*` to the manifest is a review-gate **block**.

**C. Android app-icon badge.** Android has no app-controlled badge *number*. The launcher derives
a dot (and sometimes a count) from the notification; `setNumber()` is a hint. The ongoing
notification already produces a dot on most launchers. **Promise a dot, never a number.**

**D. Glance app widget — deferred.** Needs `androidx.glance`, and `android/app/build.gradle.kts`
says in writing that a new dependency needs a reason in writing. The lock screen is already
covered by the notification.

### 2.3 What is honest to promise

| Signal | iOS | Android | Can the OS silently drop it? |
|---|---|---|---|
| Live Activity / Dynamic Island | yes, **after the owner adds the widget target** | n/a | Yes — user disabled Live Activities; and it **hard-ends at 8 h** |
| Lock screen shows the running shift | via Live Activity | via ongoing notification | Yes — notification permission denied (Android), Live Activities off (iOS) |
| Home-screen mark | **a number**, needs `.badge` auth | **a dot only**, launcher-dependent | Yes |
| Escalating reminders | local-notification ladder | local-notification ladder | Yes — permission, Focus / DND, Scheduled Summary |
| Elapsed time ticking with no app running | `Text(timerInterval:)` in the LA | `setUsesChronometer(true)` | Only with the parent signal |
| Anything at all when permissions are denied | **the in-app shift screen** | **the in-app shift screen** | **No.** This is why the in-app screen is the floor, not the extra |

---

## 3. What "locked" should responsibly mean

Not a kiosk. Not a security boundary. A **work-discipline shape**: while a shift runs, the app has
one job and looks like it. Write that in a comment where the lock is implemented, so nobody later
mistakes it for enforcement.

**The shift screen.** When `open != nil` the Log tab stops being a list with a pill on a row and
becomes a full-bleed screen:

- the **running time**, system-ticked, as the largest element on screen;
- the building name and the start time, as text;
- one instruction, the string that already exists: *"Hold your phone to the tag again to finish."*;
- state **in words**, never colour alone — "Läuft seit 3 Std 14 Min", and past 8 h
  "Über 8 Stunden — muss bestätigt werden".

**Hidden while a shift runs**

- History (nothing in it is time-critical);
- the "Recent" shift list;
- the migration-history link.

**Reachable at all times, as a labelled control and never a gesture**

- **tap out** — it is a tag tap, so there is nothing to reach; that is the point;
- **resolve unfinished shifts** — decision-10 must never be blockable;
- **materials** — the worker is standing in the building; this is precisely when they need it.
  Keep it;
- **Settings → sign out** — decision-22/26; a handed-over phone must be signable-out;
- **help** — the existing "Ask your admin" wording plus the admin contact.

**Never**: a hidden gesture, a PIN, a hold-to-exit, Guided Access, a screen the worker cannot
leave. The escape is a visible tab.

**Accessibility — the part a locked screen makes harder, and it is not optional**

1. **The running timer must not be a live region.** A per-second announcement makes VoiceOver and
   TalkBack unusable. Render the ticking text with `accessibilityHidden(true)` /
   `clearAndSetSemantics {}` and expose **one** static accessibility element whose label is
   recomputed on focus: *"Schicht läuft seit 3 Stunden 14 Minuten"*. This is the single easiest
   accessibility bug to ship here.
2. State in text, never colour. The iOS pill is text + colour today; keep the text.
3. Dynamic Type / `fontScale` 200 % → the shift screen scrolls, it does not clip. Every other
   screen in both apps already does this; match it.
4. Touch targets ≥ 44 pt / 48 dp, as `TimeSheetApp.kt` already enforces with `heightIn(min = 48.dp)`.
5. If notifications are denied, the shift screen says so **once**, in a sentence, with a link to
   Settings. Never a modal, never a nag, and **never before a clock-in**.

---

## 4. Recovery — the server is the truth (`GET /shifts/open`)

| What broke | What brings the signal back | Comment |
|---|---|---|
| App swiped away / OOM-killed | Nothing needed. iOS: the Live Activity is system-owned. Android: the notification is `NotificationManager`-owned | Both recover fully |
| Phone rebooted | iOS: Live Activity persists (community-reported — verify on hardware) and pending local notifications persist. Android: **all notifications are cleared** → a `BOOT_COMPLETED` receiver reposts from the local open shift | Android needs ~20 lines; no network |
| Notification permission denied | Nothing out-of-app. In-app shift screen unaffected. The app says so once | Honest degradation |
| Notification swiped away (Android 14+) | Reposted on the next app foreground and after the next `adoptServerOpenShift()` | **Cannot** be reposted while no process runs. Name this |
| Worker chose "Turn off" on the Live Activity | Restarted on the next foreground launch when `GET /shifts/open` returns a shift | `Activity.request` needs the foreground; there is no other way |
| App reinstalled / new phone | `adoptServerOpenShift` already exists on both (`Sync.swift`, `ShiftSync.kt`) | **Key wire:** the signal must be armed by **one** function taking "the open shift as the app currently believes it", called from **both** the tap path and the adopt path |
| Server auto-closed at 8 h while the phone was offline | Next refresh via `/shifts/unresolved`; the signal must **flip** from "running" to "needs confirming" | Never leave a running timer on a shift the server already closed |
| No signal for the whole shift | The app computes `start + 8 h` **locally** and flips its own copy to "over 8 hours — will need confirming" | Cheap, honest, no new endpoint, no server round trip |

**Genuinely unrecoverable**

1. Any out-of-app signal, for the whole window in which the app is not running, if the OS dropped
   it (permission denied, Live Activities off, Android reboot without the receiver). No process
   means no ability to re-arm. There is no fix; there is only not lying about it.
2. The iOS Live Activity past 8 hours. Hard system limit; it ends at the same moment the
   auto-close fires. No extension exists.
3. A worker who never opens the app again. decision-10 already accepts this in writing: *"worker
   never opens app again → shift stays excluded from payroll forever (correct behavior)"*. Nothing
   here changes it.
4. Making the worker look at the phone. Every one of these signals is passive. The only active
   pressure available is the reminder ladder, and Focus can eat it.

---

## 5. Risks, ranked — anything that can break the live iOS app or block a clock-in first

**R1 — `project.pbxproj`, and whether `import ActivityKit` needs a link phase.**
Agents must never edit it. `import ActivityKit` from the app target *usually* links implicitly
with modern Swift, but this is not certain and it is the one change that could break the shipped
build. **Rule: the build agent must build before and after. If the link fails, STOP and hand it to
the owner — do not touch the project file.** All ActivityKit code sits behind one
`LiveActivityController` that checks `areActivitiesEnabled`, wraps `request` in `try?`, and does
nothing on failure — so it is inert until the widget target exists.

**R2 — a blocked clock-in.** Any `await`, permission prompt, or `Activity.request` on the tap path
can delay or throw before the local row is written. **Hard rule:** in `LogView.handleTap` and
`TimeSheetViewModel.writeTap`, the local write and save happen **first**; every signal is armed
**after**, off the critical path, non-throwing. A cache miss, a denied permission and a dead
network are all "arm nothing", never "reject the tap". One runnable check pins this.

**R3 — prompting for notifications at the wrong moment.** At a door, at 06:02, with gloves on,
before the first tap. **Never prompt before the first successful clock-in.** Prompt once,
afterwards, from the shift screen, with a sentence saying what it buys. Denial = one sentence,
once, then silence.

**R4 — screen-reader spam.** A live region on the ticking timer. Designed against in §3;
must be verified, not assumed.

**R5 — an Android foreground service.** Would drag in a Play declaration + demo video + review on
a personal account (decision-27) for zero visibility gain (§2.2). **Review-gate block.**

**R6 — the lock traps a worker.** Hiding sign-out or the resolver breaks decision-10 and
decision-22/26. Escape hatches enumerated in §3 are mandatory, not suggestions.

**R7 — decision drift on decision-10.** Its point 3 says "No skip/dismiss"; both apps now ship a
"Later" button, deliberately and for a good reason recorded in code comments, but **no superseding
decision record exists**. This work touches that screen. Either write a new decision that
supersedes it, or leave the behaviour exactly as-is. **Do not re-tighten it** — a hard block at the
door already cost paid time once.

**R8 — building the new screen in hardcoded English.** iOS has no localisation at all (row 22)
while Android ships German by default. A large new shift screen in English deepens the decision-8
debt on the platform actually in daily use. Put the new screen's strings in a **new**
`Localizable.xcstrings` — the app target uses `fileSystemSynchronizedGroups`, so a new file needs
no project edit — and migrate the rest later.

**R9 — iOS telemetry is off.** `Info.plist SentryDSN` is `""`, so `Telemetry.start()` never starts
the SDK. If the new signal fails on a real phone, nobody finds out. Owner decision, not an agent's.

**R10 — Android has no telemetry at all**, by design. Same blind spot, and worse. Not to be
"fixed" inside this work.

---

## 6. The plan the build agents follow

Ordered so that after step 5 the product is already better with **zero** OS permissions and
**zero** project changes, and everything after that is additive and individually droppable.

### Phase A — the floor: in-app, no permissions, no project edits

1. **Shared vocabulary, both platforms, no behaviour change.** Add one derived value on each
   platform for "what the app currently believes about the open shift": `nil`, or
   `(locationId, locationName, startTime, isOverEightHours)`. iOS: a computed value off the
   existing `@Query`. Android: off `LogState.open`. `isOverEightHours` is computed **locally**
   from `startTime`, no server call. Nothing else changes.
   *Check:* extend `android/checks/core-check.kt` with the 8 h boundary (7 h 59 → false,
   8 h 01 → true). No new iOS check yet.

2. **iOS shift screen.** When the derived value is non-nil, `LogView` renders a full-bleed shift
   screen instead of the list: building name, start time, `Text(timerInterval:)` running clock as
   the dominant element, the existing "hold your phone to the tag again to finish" instruction.
   Text state, not colour state. `ScrollView` so 200 % Dynamic Type does not clip. The ticking
   text is `accessibilityHidden(true)`; **one** sibling accessibility element carries the spoken
   duration. Strings go into a new `Localizable.xcstrings` (new file, **no project edit**) with
   German as the default and English alongside.

3. **Android shift screen.** Same shape in `TimeSheetApp.LogScreen`: full-bleed when
   `log.open != nil`, dominant elapsed time, `verticalScroll`, `clearAndSetSemantics` on the
   ticking text plus one static spoken duration. Strings into `values/` (German) and `values-en/`,
   keeping the key-set parity that `android/checks` already asserts.

4. **The lock, both platforms.** While the shift screen is showing: hide History, hide "Recent",
   hide the migration link. Keep visible and labelled: Materials, Settings → sign out, the
   resolver banner, help. No gestures, no PIN, nothing hidden.
   *Check (one, iOS, runnable without Xcode):* a pure function
   `visibleTabs(openShift:unresolvedCount:) -> [Tab]`, in a Foundation-only file so it can be
   `cat`-ed into a `NFCTimeSheets/checks/lock-check.swift` in the style of the existing checks.
   It must assert that Materials, Settings and the resolver are present in **every** state.
   Mirror the same function and assertion in `android/checks/core-check.kt`.

5. **Flip on auto-close.** When the local `start + 8 h` boundary passes, or `/shifts/unresolved`
   returns the shift, the screen stops showing a running timer and shows "over 8 hours — must be
   confirmed" with the resolver one tap away. Never a running clock on a shift the server closed.
   *Check:* covered by the step-1 boundary assertion.

### Phase B — Android out-of-app signal (no new target, no Play review)

6. **Ongoing notification.** New file
   `android/app/src/main/kotlin/.../notify/ShiftNotification.kt`. One channel,
   `IMPORTANCE_DEFAULT`, created on first use. `setOngoing(true).setWhen(start).setUsesChronometer(true)`,
   content intent → `MainActivity`. Posted when a shift opens or is adopted, cancelled when it
   closes, replaced with "must be confirmed" past 8 h. Manifest gains **only**
   `POST_NOTIFICATIONS`. **No `FOREGROUND_SERVICE*` of any kind** (R5).

7. **Permission, at the right moment.** Version-gate on API 33+. Requested **after** the first
   successful clock-in, from the shift screen, never on launch and never before a tap. Denied →
   one sentence on the shift screen with a link to app notification settings, then never again.
   Everything else keeps working.
   *Check:* extend `core-check.kt` with a pure `shouldAskForNotifications(sdkInt:hasClockedIn:alreadyAsked:denied:)`
   asserting it is false before the first clock-in and false on API < 33.

8. **Reminder ladder.** `AlarmManager` (`setExactAndAllowWhileIdle` is not needed — inexact is
   correct and cheaper) or a small `WorkManager`-free `setWindow` ladder at +1 h … +8 h, each rung
   posting a distinct message. Cancelled on tap-out. If permission is denied, schedule nothing.

9. **Reboot receiver.** `RECEIVE_BOOT_COMPLETED` (normal permission, no dialog) +
   a `BOOT_COMPLETED` receiver that reads the local open shift from SQLite and reposts. No
   network. Comment that it is not delivered to a force-stopped app.

### Phase C — iOS out-of-app signals that need no target

10. **App icon badge.** `setBadgeCount(1)` while a shift is open, `setBadgeCount(0)` on close.
    Requires `.badge` in the authorization request; denial changes nothing else. Comment the rule:
    **the open shift owns the app-icon badge; materials never touch it.**

11. **Permission + reminder ladder.** Same rule as step 7 — requested only after the first
    successful clock-in, from the shift screen, once. Ladder of one-shot
    `UNTimeIntervalNotificationTrigger`s at +1 h … +8 h with distinct copy, cancelled by one
    `removePendingNotificationRequests` on tap-out. `interruptionLevel = .timeSensitive`
    (degrades to `.active` without the capability — that is fine and is the expected state).
    Well under the 64-pending ceiling.

12. **Prove nothing blocks a tap.** Extend `NFCTimeSheets/checks/tap-inbox-check.swift` or add
    `checks/signal-check.swift`: the tap handler writes and saves the local row **before** any
    signal call, and a signal call that throws leaves the row untouched. This is the R2 guard and
    it is the one check that must exist.

### Phase D — the Live Activity, which the owner must unlock

13. **Ship the code inert.** `LiveActivityController.swift` + `ShiftActivityAttributes.swift`, both
    new files in the app target (no project edit). Every entry point:
    `guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }`, `try?` around
    `request`, silent no-op on failure. Add `NSSupportsLiveActivities = YES` to
    `NFCTimeSheets/Info.plist` (already wired via `INFOPLIST_FILE`, **no project edit**).
    Use only `Activity.request(attributes:content:pushType:)` — iOS 18 surface.
    **Build before and after. If linking `ActivityKit` demands a project change, STOP (R1).**

14. **Write the owner's click-path**, as a new `docs/` file, exact and short:
    Xcode → File → New → Target → **Widget Extension** → name it, **tick "Include Live Activity"**,
    do **not** tick "Include Configuration Intent" → embed in the `NFCTimeSheets` app target →
    move `ShiftActivityAttributes.swift` into the shared membership → build → tap a tag.
    Plus, optional and separate: app target → Signing & Capabilities → **+ Capability** →
    **Time Sensitive Notifications** (this is what upgrades the ladder from `.active`).
    State plainly in the doc: **the Live Activity ends at 8 hours, and that is a system limit.**

15. **Verify on hardware, then promise.** Live Activity survival across force-quit and reboot is
    community-reported, not documented (§2.1). Before it is described to the owner as a feature,
    somebody taps in, force-quits, reboots, and looks. Write the result down.

### Phase E — parity cleanups, each independently droppable

16. Android resolver gains a date, or the +1-day roll is documented as the accepted ceiling
    (row 14).
17. iOS switch-notice moves from `alert` to an in-list card, killing the alert/sheet collision
    (row 9).
18. iOS gains the "there is no push, this only updates when you open the app" sentence that
    Android already shows (row 20).
19. iOS error strings and the rest of the UI move into `Localizable.xcstrings` with German first
    (rows 21–22, decision-8). Large; its own task; not a prerequisite for anything above.
20. Android checks the `sessionRejected` flag outside `refresh()` (row 4).

### Standing rules for every step

- Never edit `NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj`.
- Never add a server dependency; nothing above needs one.
- Never add an Android foreground service.
- The local row is written and saved **before** any signal work, always.
- A denied permission is a weaker signal and a single honest sentence — never a blocked tap,
  never a nag.
- State in text, not colour. The timer is one accessibility element, not a live region.
