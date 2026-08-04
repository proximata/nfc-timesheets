# Live Activity — the two things only you can do in Xcode

Everything else for the in-shift signal is already committed and already works. This file
is the short list of clicks that no agent is allowed to make, because both of them edit
`NFCTimeSheets.xcodeproj/project.pbxproj`, which is yours by hand.

**The app builds, ships and behaves correctly today without doing any of this.** The code
below is inert: with no widget extension `Activity.request` throws, `LiveActivityController`
swallows it, and the worker gets the badge, the reminders and the full-screen shift screen
exactly as they do now. Doing the steps *adds* the Lock Screen and Dynamic Island.

---

## What already ships, with no project edit

| Signal | Where | Needs you? |
|---|---|---|
| Full-screen shift screen with a running clock | `ShiftScreen.swift` | no |
| App-icon **badge** while a shift is open | `ShiftSignalCenter.arm` | no |
| Escalating reminders at +1 h … +8 h | `ShiftSignalCenter.scheduleLadder` | no |
| `NSSupportsLiveActivities` | `NFCTimeSheets/Info.plist` | no — already set |
| `ShiftActivityAttributes.swift`, `LiveActivityController.swift` | new `.swift` files | no — the app target uses `fileSystemSynchronizedGroups`, so new files need no project edit |
| **Live Activity actually rendering** | needs a widget extension **target** | **YES — step 1** |
| Reminders breaking through Focus / Scheduled Summary | needs the Time Sensitive capability | **YES — step 2, optional** |

Verified on this machine, against the real project, before and after the code landed:

```
xcodebuild -project NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
  -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO
** BUILD SUCCEEDED **

otool -L .../NFCTimeSheets.debug.dylib | grep ActivityKit
  /System/Library/Frameworks/ActivityKit.framework/ActivityKit
```

`import ActivityKit` autolinks. It did **not** need a project change. That was the one risk
in this whole piece of work and it is closed.

---

## Step 1 — the widget extension target (this is what turns the Live Activity on)

1. Xcode → **File → New → Target…**
2. Choose **Widget Extension**. iOS.
3. Product Name: `ShiftActivity`.
4. **Tick "Include Live Activity".**
5. **Untick "Include Configuration App Intent".** We do not want a configurable widget;
   there is nothing for a worker to configure.
6. Finish → when Xcode offers to **activate the "ShiftActivity" scheme**, say **Activate**.
7. Xcode adds `ShiftActivity/` with its own `ShiftActivityLiveActivity.swift` and a
   `...Attributes` struct. **Delete the generated attributes struct** — ours already exists
   and the app writes to it.
8. Select `NFCTimeSheets/NFCTimeSheets/ShiftActivityAttributes.swift`. In the File
   Inspector (⌥⌘1), under **Target Membership**, tick **both** `NFCTimeSheets` *and*
   `ShiftActivity`. The app starts the activity; the extension draws it; both need the
   type. It is in its own file precisely so this is one tick.
9. In the extension's `...LiveActivity.swift`, render `context.attributes.locationName`,
   `Text(timerInterval: context.attributes.startTime...context.attributes.startTime.addingTimeInterval(8*3600), countsDown: false)`
   and, when `context.state.overdue`, the words "Über 8 Stunden — muss bestätigt werden"
   instead of the clock. **The state must be in words, not only in colour.**
10. Build. Run on a real phone. Tap a tag.

### The rules that survive step 1

- **Eight hours, hard.** Apple ends any Live Activity after 8 hours. That is exactly when
  `nfc-autoclose.timer` closes the shift, so the Live Activity can never outlive the shift
  it describes. Never tell a worker "it stays until you tap out" — say "it is there while
  the shift is".
- **Starting needs the foreground.** A tag tap opens the universal link, which foregrounds
  the app, so the tap path is a legal place to start one. Nothing else is.
- **The worker can switch Live Activities off** for this app in Settings.
  `ActivityAuthorizationInfo().areActivitiesEnabled` is checked and the app degrades in
  silence — badge and reminders keep working.
- **iOS 18.0 API surface only.** `Activity.request(attributes:content:pushType:)` and
  nothing else. The `style:`, `startDate:` and `alertConfiguration:` overloads and
  `ActivityStyle.transient` are newer than the deployment target.

### Verify on hardware before you promise it to anyone

Live Activity survival across force-quit and reboot is community-reported, not documented
by Apple. Before describing it as a feature: tap in, force-quit the app, reboot the phone,
look at the Lock Screen. Write down what you saw.

---

## Step 2 — Time Sensitive notifications (optional)

Without this the reminder ladder still fires; it is just held back by Focus and by
Scheduled Summary like any ordinary notification. The code already asks for
`interruptionLevel = .timeSensitive`, which the system silently downgrades to `.active`
until the capability exists — so this is a pure upgrade with no code change.

1. Xcode → project → target **NFCTimeSheets** → **Signing & Capabilities**.
2. **+ Capability** → **Time Sensitive Notifications**.
3. Build. That is all.

**Not** `.critical` / Critical Alerts. That entitlement is granted by Apple only on a
request form, for medical, safety and security apps. A timesheet is none of those and
asking for it is a review risk for nothing.

---

## What is still impossible, so nobody spends a day on it

| Wanted | Why not |
|---|---|
| A push that updates the Live Activity | There is no APNs certificate and decision-23 caps the server's dependencies at `pg` + `@sentry/node`. `pushType: nil` on purpose. |
| A signal past 8 hours | System limit, no extension mechanism. The shift is auto-closed at that moment anyway (decision-10). |
| Locking the phone to the app | Guided Access is user-initiated; Single App Mode is MDM-only. The lock in this app is work discipline, not a kiosk — and it must never trap a worker. |
| A background timer that re-arms the signal | `BGAppRefreshTask` is opportunistic, not a clock. The badge and the pending notifications already survive without a process. |
