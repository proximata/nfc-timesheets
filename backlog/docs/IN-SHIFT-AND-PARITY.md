# What a worker sees while a shift is running — and where the two apps still differ

For the director. No code. Written after verifying the working tree by running it, not by
reading the reports that came with it.

---

## Read this first

**Nothing is blocking, but nothing is live yet.**

| | Status |
|---|---|
| Is anything broken in what workers use today? | **No.** The live server was not changed at all. The current TestFlight app keeps working exactly as it does this morning. |
| Can workers see any of this yet? | **No.** It is code on a laptop. |
| **iOS needs a new TestFlight build to reach anybody.** | Nothing described below appears on a single phone until a new build is uploaded to TestFlight and testers update. |
| Android needs a new release build for the same reason. | The app was rebuilt and passes, but the file on the crew's phones is the old one. |
| Anything the owner must do by hand? | **One optional thing** — the Lock Screen widget on iPhone. Ten clicks in Xcode, listed at the end. Everything else ships without touching Xcode. |

The server was deliberately left alone. Not one route, field or database change. The only
edits to server files were written explanations and extra self-tests. That is the reason
the "is anything broken today" answer is a flat no.

---

## 1. The problem this solves

A worker taps in at 06:02, puts the phone in a pocket, and goes home. Nothing on that phone
ever mentions the shift again. Eight hours later the server closes it automatically, the
shift drops out of payroll until somebody confirms the real finish time, and the office pays
for a manual correction.

Before this work the entire in-app signal that a shift was running was **a small orange
label on one row of a list**. On Android it was **the word "Läuft" on a row**. You had to
open the app and look for it.

---

## 2. What a worker sees now, on both phones

The moment they tap in, the app stops being a list and becomes one screen about one thing.

- The **name of the building** in large type.
- A **clock counting up**, in 64-point digits, readable across a room.
- The state **in words** — "Eingestempelt" — under the clock, never colour alone.
- The **whole background** turns green, and red once the shift passes eight hours.
- One instruction and only one: **hold your phone to the tag again to finish.**
- The tab for *Verlauf* (history) disappears while the shift runs.

There is no in-app "clock out" button and there deliberately never will be one. The tag is
the only way to end a shift, so two mechanisms can never disagree about somebody's hours.

### The lock is discipline, not a cage

While a shift is running the worker can still, at every moment and as a plainly labelled
button — never a hidden gesture:

- **Request material.**
- **Sign out** (Einstellungen), so a handed-over phone can change hands.
- **Confirm an unfinished shift**, when the system is waiting on one. This is never hidden.
- **Read the help card**, which says in so many words that they are not stuck and where to
  go for hours, locations and payroll.

Only *Verlauf* is taken away, because nothing in it is urgent. This was checked by
deliberately breaking it: hiding the material tab makes the build fail with the message
*"material is reachable while a shift runs — that is exactly when it is needed"*.

---

## 3. What each phone can show outside the app

This is the part the director should read twice, because the two operating systems are
genuinely not equal here, and promising something an OS cannot do is how a crew stops
trusting the app.

| Signal | iPhone | Android |
|---|---|---|
| A number on the app icon on the home screen | **Yes**, guaranteed. A "1" sits on the icon for the whole shift. It survives closing the app and restarting the phone. | **No — a dot, not a number,** and even the dot depends on the phone's launcher. Android gives apps no way to demand a number. |
| A permanent line on the lock screen with a live running clock | **Only after the optional Xcode step** (below). | **Yes**, and it is arguably the better one: the system draws the ticking clock, it survives closing the app, and it has **no time limit**. |
| Escalating reminders at 1, 2, 3 … 8 hours, each with different wording | Yes | Yes |
| The 8-hour message ("this was closed automatically, confirm when you actually finished") | Yes | Yes |
| Everything cleared the instant they tap out | Yes | Yes |
| Survives a phone restart | Icon number and reminders: yes | Notifications are wiped by a restart; the app puts them back at first unlock |
| Survives the worker force-closing the app | Yes | The reminders do; the lock-screen line comes back next time they open the app |

### What neither phone can do, stated plainly

- **If the worker force-closes the app and never opens it again, no phone can show
  anything.** Both operating systems refuse to run anything in a force-stopped app. There is
  no fix. The eight-hour auto-close is the backstop, and it always was.
- **On iPhone the lock-screen line has a hard eight-hour ceiling**, set by Apple. That is
  exactly when the shift is auto-closed anyway, so it can never outlive its shift — but
  never tell a worker "it stays there until you tap out". Say "it is there while the shift
  is".
- **On Android the worker can swipe the lock-screen line away.** Android 14 changed this and
  it cannot be prevented. It resists *Clear all* and comes back next time the app is opened.
  Promise "it is on your lock screen", never "you cannot get rid of it".
- **We deliberately did not build an always-running background service on Android.** It
  would buy *zero* extra visibility — Google puts its notification behind the same
  permission — and would cost a Play Store content declaration, a demonstration video and a
  review, on a personal developer account. The build now fails on purpose if anybody adds
  one.

### If the worker says no to notifications

Nothing breaks. **Clocking in is never blocked by anything** — not by a permission prompt,
not by a dead network, not by a fresh install with no data cached, not by this new screen.
The full-screen shift screen is unaffected, and the app says once, as a single sentence with
a link to Settings, that it cannot remind them. It is never repeated and never a pop-up.

The permission is asked **once, after the first successful clock-in, from the shift screen** —
never at the front door at 06:02 with gloves on, where a "no" would be permanent. This
ordering is enforced by a test: moving the reminder work in front of saving the shift makes
the build fail with *"a tap in a basement counts even if every signal fails; the reverse
would lose paid time"*.

---

## 4. What the owner must click in Xcode

**Optional.** The app is better than today's build without doing any of it. This only adds
the iPhone lock-screen line and Dynamic Island.

Full click-path: `docs/LIVE-ACTIVITY-SETUP.md`. In summary:

1. **File → New → Target… → Widget Extension**, name it `ShiftActivity`, **tick "Include
   Live Activity"**, **untick "Include Configuration App Intent"**.
2. Delete the sample data type Xcode generates — ours already exists.
3. Select `ShiftActivityAttributes.swift` and tick **both** targets under Target Membership.
   That file exists on its own purely so this is one tick.
4. Draw the lock-screen view: building name, the running clock, and — when overdue — the
   words *"Über 8 Stunden — muss bestätigt werden"* instead of the clock. **In words, not
   just red.**
5. Optional second capability: **Time Sensitive Notifications**, which lets the reminders
   break through Do Not Disturb. The code already asks for it and is silently downgraded
   until it exists, so this is a pure upgrade with no code change.

Until step 1 is done the code sits there doing nothing at all. That was verified rather than
assumed: the app was built and the Apple framework confirmed linked, without the project
file being touched.

**Then test it on a real phone before promising it to anyone.** Whether the lock-screen line
survives a restart is community folklore, not documented by Apple. Tap in, force-quit,
restart the phone, look, and write down what you saw.

---

## 5. What is still different between the two apps

Re-derived from the code, not from anybody's summary. The two apps now call an identical set
of server endpoints save for two, and use the same set of tabs computed by the same rule
written twice.

### Genuine — the platform or a past decision forces it

| What | iPhone | Android |
|---|---|---|
| How a worker signs in | Sign in with Apple | 8-character enrolment code from the admin (decision-26) |
| "You signed in but you're not on staff" | Exists, with a screen explaining it | Cannot happen — a code the admin issued *is* a worker |
| NFC health warnings ("NFC is switched off") | Not shown — an iPhone has no NFC switch to check | Shown, with a link to the right settings screen |
| Error reporting to Sentry | Yes | No (decision-23 scopes it to the server and iOS) |
| Migrating data from old app versions | Yes | Nothing to migrate from — Android has no old installs |
| Home-screen mark | A number | A dot at best |
| Lock-screen line | Needs the Xcode step; 8-hour ceiling | Ships now; no ceiling; dismissible |

### Deliberately not done, with the cost written down

| What | Why it was left |
|---|---|
| Both apps still offer a **"Later"** button on the confirm-your-finish-time screen, although decision-10 says there should be none | Both apps softened this on purpose after a hard block once cost a worker paid time at a door. **The written decision and the shipped behaviour disagree and there is no record superseding it.** This should be resolved on paper, and it should be resolved in favour of what ships. Do not re-tighten it. |
| Neither app retries sending data in the background | A shift taken with no signal waits until the app is next opened. Equal on both. |
| Neither test suite checks the layout at the largest font size | Needs a real phone. Both screens scroll, which is the mitigation. |
| Android has no swipe-to-delete on its own history list; iPhone does | Android is arguably the correct one — it looks like deleting hours, and it is not. |
| iPhone German is the *catalogue* language, not the *fallback* | A phone set to German gets German. A phone set to some third language gets English on iPhone, German on Android. Fixing it is one setting in Xcode: `DEVELOPMENT_REGION = de`. |

### One small cosmetic defect, found during verification, not fixed

Two German sentences on a rarely-seen screen (the one-time "we tidied up old records" notice
after upgrading from an old app version) read as *"4 alte Schichts"* and *"4 altes
Eintrag/Einträge"*. The English original builds its plural by adding an "s", which German
does not do. It is confined to that one screen, it is not on the clock-in path, and it does
not touch anybody's hours. Fixing it properly means changing the original English sentences,
which are older than this work; it is worth its own small task rather than a rushed patch.

---

## 6. Accessibility

A screen that is mostly one enormous ticking number is exactly where a screen reader goes
wrong, so this was handled explicitly on both platforms:

- The ticking digits are **hidden from the screen reader**. One single spoken label carries
  the whole thing: *"Schicht läuft seit 3 Stunden 14 Minuten bei Westbahnhof"*.
- That label **changes once a minute, not once a second**, so VoiceOver and TalkBack are not
  interrupted continuously. This is enforced by a test.
- Every state is **written in words**, never colour alone.
- Both screens **scroll**, so at the largest font setting the instructions cannot be pushed
  off the bottom of the screen.
- Android uses theme colours, so dark mode and the high-contrast settings work.

Not provable without a phone in a hand: how it actually looks at 200% text size. Both screens
scroll, which is the mitigation, and it is listed above as an open item.

---

## 7. What was actually run to verify this

Every one of these was executed on this machine, in this order, and the result is what is
written:

- The iPhone project file, the branding file and the signing entitlements: **untouched.**
- The server's live behaviour after stripping comments: **byte-for-byte identical.**
- The live site answered normally throughout.
- iPhone app: type-checks, and **builds** for a real device.
- The German translations were pulled out of the **built app** and looked up with the exact
  sentences the app asks for. All of them came back in German.
- Android: **builds**, both debug and release.
- All self-tests pass: 7 on iPhone, 1 suite on Android, 132 on the server, plus the
  eight-hour auto-close and the branding gate.
- Secret scanner: **clean** on everything tracked.
- Six of the new tests were deliberately broken one at a time to confirm they actually
  catch the mistake they claim to. All six failed, correctly, and were restored.

**One real defect was found and fixed during this verification.** On iPhone, tapping out
cancelled the reminders that had not yet fired but left the ones already delivered sitting in
Notification Center — so a worker who finished at 07:40 kept a "Still clocked in" banner from
07:00 on their phone. A stale message telling somebody they are still working is worse than
no message at all. Android was already correct. Both are now covered by a test that fails if
it is ever undone.
