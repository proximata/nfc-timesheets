# iOS ⇄ Android parity — what is the same, what differs, and why

The two clients read the same tags, speak the same API and are meant to behave the same.
This file is the record of where they do not, and it distinguishes two things that get
confused constantly:

- **GENUINE** — a platform capability or an accepted decision forces the difference. It is
  not going to be closed, and the closest honest equivalent is named.
- **CEILING** — nobody has written it yet, deliberately, with the cost and the upgrade path
  written down.

Anything that was merely *missing* has been closed. It is not listed here; it is in the
code.

Source: `research/in-shift-signal-and-parity-audit.md`, which enumerated 27 rows against
the working tree. This file records the disposition of every row that did not end at
parity.

---

## GENUINE — platform or decision, not laziness

| # | What | iOS | Android | Why it cannot be closed |
|---|---|---|---|---|
| 1 | Identity | Sign in with Apple | 8-character enrolment code | decision-26 chose the code for Android and forbids changing iOS mid-pilot. Both end at a session cookie and a server-side worker id (decision-22). |
| 2 | "Authenticated but not a worker" | `SessionState.ineligible` → `IneligibleView` | does not exist | A redeemed enrolment code **is** a worker by construction. Apple will happily authenticate somebody nobody hired; a code the admin issued by name cannot. |
| 6 | NFC health banner | none | `nfc/NfcReadiness`: unsupported / disabled / tag-intents-blocked | An iPhone has no user-facing NFC toggle and no per-app tag-intent allowlist. There is nothing to check and nothing to link to. |
| 24 | Telemetry | Sentry (`Telemetry.swift`) | none | decision-23 scopes Sentry to the API and iOS. A third SDK on Android is a decision, not an implementation detail. |
| 25 | Legacy-data migration + receipt | `DataMigrations`, `MigrationReceiptView` | none | Android has no legacy installs. There is nothing to migrate from. |
| — | Live Activity / Dynamic Island | yes, once the widget target exists (`docs/LIVE-ACTIVITY-SETUP.md`) | n/a | Android has no equivalent. **Closest honest equivalent, and it is arguably better:** an ongoing notification with `setUsesChronometer(true)`, which the system ticks, survives process death, and has **no 8-hour ceiling** — unlike the Live Activity, which Apple hard-ends at exactly 8 h. |
| — | Home-screen mark | app-icon badge, a **number** | a **dot**, launcher-dependent | Android has no app-controlled badge count; `setNumber()` is a hint the launcher may ignore. The ongoing notification already produces a dot on most launchers. Promise a dot, never a number. |
| — | Non-dismissible ongoing notification | n/a | **not possible** | Android 14 changed `FLAG_ONGOING_EVENT` so users can dismiss ongoing notifications while unlocked. It still resists *Clear all* and stays on the lock screen. Promise "it is on your lock screen", never "you cannot get rid of it". |
| — | Foreground service | n/a | **refused, on purpose** | It buys **zero** extra visibility — Google's own docs put non-exempt FGS notifications inside the same `POST_NOTIFICATIONS` gate — and costs a `specialUse` subtype property, a Play App-content declaration with a demonstration video, and review, on a personal Play account (decision-27). `android/checks` fails the build if a `FOREGROUND_SERVICE*` permission appears. |
| — | Reboot recovery | pending local notifications and the badge survive; the Live Activity is reported to survive (unverified on hardware) | **every notification is cleared**; `notify/BootReceiver` reposts from SQLite at first unlock | `LOCKED_BOOT_COMPLETED` is deliberately not declared: it is delivered only to `directBootAware` components, which cannot read `timesheets.db`. Neither platform recovers if the app was force-stopped. |

---

## CEILING — not written, deliberately

| # | What | State | Cost of leaving it | Upgrade path |
|---|---|---|---|---|
| 10 | iOS sync ordering rules are inline in `Sync.swift`; Android's are a pure `core/SyncPlan` that `android/checks` runs | iOS's rules are covered only indirectly | A refactor of `syncPending` could reorder open-before-close and nobody would find out until a 409 at a door | Extract the ordering and blocking rules from `Sync.swift` into a Foundation-only `SyncPlan.swift` and `cat` it into a check, exactly as Android does. Mechanical, and its own task. |
| 16 | Both apps ship a "Later" button on the resolver; decision-10 point 3 says "No skip/dismiss" | Deviation is deliberate and reasoned in code comments on **both** platforms, but **no superseding decision record exists** | The written decision and the shipped behaviour disagree | Write a decision superseding decision-10 point 3. **Do not re-tighten it** — a hard block at the door already cost paid time once, which is why both platforms softened it. |
| 17 | iOS `HistoryView` has swipe-to-delete on local rows; Android has none | Android is arguably correct | A worker cannot tidy their own local list on Android | Deliberately not closed: deleting a local row is a footgun that looks like deleting hours (it does not — the server keeps what was sent). If it is ever added it needs the same "this only removes the local copy" wording iOS has in a comment and does not have on screen. |
| 11 | Neither platform retries sync in the background | Equal on both | A shift taken with no signal sits until the app is next opened | iOS: `BGAppRefreshTask`. Android: `WorkManager` with a network constraint. Both already have this ceiling recorded at the call site. |
| 23 | Neither checks suite asserts a font-scale / Dynamic Type layout | Equal on both | A clipped shift screen at 200 % would only be found on a phone | Needs a UI test on a device or a simulator; neither runner has one. Both shift screens are in a scroll container, which is the mitigation. |

---

## Closed by this work

For the record, so nobody re-opens them looking for something to do:

- **The in-shift signal itself** (row 27). Was: an orange pill on a row (iOS) and the word
  "Läuft" on a row (Android), both in-app only, both invisible unless the app was open.
  Now: a full-screen shift screen with a system-ticked clock on both, plus the app-icon
  badge and an escalating reminder ladder (iOS) and an ongoing lock-screen notification
  with a system chronometer plus the same ladder (Android).
- **The lock** — `ShiftSignal.visibleTabs` on both, same rule, both check-covered.
- Row 4 — Android now observes `sessionRejected` as a flow from the `Api` choke point,
  so a 401 from *any* path signs the worker out immediately, as iOS has always done.
- Row 9 — the iOS switch notice is a card, not an alert. SwiftUI silently drops one of an
  alert and a sheet presented together, so the old alert could eat the decision-10
  resolver on exactly the tap that created an auto-closed shift.
- Row 14 — the Android resolver has a date **and** a time, and shows the resulting
  timestamp in words before it is sent. The old +1-day roll survives as the suggestion.
- Row 15 — "Shift 2 of 3" on both resolvers. decision-10 point 3 asked for it.
- Row 20 — iOS says "this app has no push" on screen, as Android already did; Android now
  says it on the log screen too, not only on the material screen.
- Rows 21–22 — **iOS is localised.** `NFCTimeSheets/Localizable.xcstrings`, 112 keys
  extracted by the compiler (never typed by hand), all German, using the same vocabulary
  as `web/messages/de.json` and `android/.../values/strings.xml`: Objekt, Schicht,
  Mitarbeiter, eingestempelt, Verwaltung. `checks/localisation-check.swift` fails if a key
  is untranslated or a placeholder does not match.

  **Ceiling on that one:** German is the *catalogue* language, not the *fallback*. On iOS
  the fallback is the target's development region, which lives in `project.pbxproj` and is
  not an agent's to change. A German-locale phone gets German; a phone set to Klingon gets
  English. Android puts German in `values/`, so it is the fallback for everything. To make
  iOS match, set `DEVELOPMENT_REGION = de` in Xcode.
