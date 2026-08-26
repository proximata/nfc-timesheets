# UAT-WALKTHROUGH — everything the three journey passes found, ranked by how much a real user is bothered

Date: 2026-08-24. Three explorers drove three journeys in parallel against **isolated local
stacks only** — own scratch Postgres clusters, own TLS fronts, the ts-demo emulator.
`schimmer-glanz.exe.xyz` and `timesheets.exe.xyz` were never touched.

| Journey | Who | How it ran |
|---|---|---|
| **W** worker | Cleaner on Android: install → enrolment code → tap in → tap out → Settings → sign out → SMS sign-in | live on emulator, NFC tap simulated with the exact `ACTION_VIEW` intent a real tag produces |
| **O** operator | Cleaner who also mounts and tests cards: reach *Tag beschreiben* / *Tag prüfen* without a worker session | Android live, iOS **code-read only** (CoreNFC does not run in Simulator) |
| **A** admin | Owner onboards their SECOND building: sign in → building + inline client → unbound card → verified zone → worker + operator codes → /shifts/ + /payroll/ | live over CDP against the current `web/out` build |

## The ordering rule used here

Ranked by **how much a real UAT user would be bothered**, per the owner's instruction —
not by technical or security severity. The owner's words: *"no need to care about loss of
data at this stage — still piloting the UAT… I want the ordering by UX importance… we are
not on live stage yet, and client is highly loyal."*

TASK-240 and TASK-247 were closed **Wont Do** in this same session on exactly that basis. An
unresolved tag correctly refusing to open a shift is **wanted behaviour**. Nothing in this
list resurrects them, and TASK-262 says so explicitly in its own body.

Existing tasks are ranked in the same flat list as the new ones, by the same lens.

---

## The ranked list

| # | Task | Why a non-technical owner cares | From |
|---|---|---|---|
| 1 | **TASK-255** — /tags/ is a raw HTML table with no i18n | The one screen that turns a card an operator mounted into a working zone looks unfinished, exactly when the owner most needs to believe the product works. | A · resolve reported tag |
| 2 | **TASK-256** — iOS: five operator strings render raw English | The first thing a signed-out operator sees on a German phone is half in English, which reads as broken rather than as a choice. | O · iOS source read |
| 3 | ~~TASK-254~~ — operator-only Android phones have no self-update path | MOOT 2026-08-26: the whole self-update subsystem was deleted once Android distribution moved to the Play Store; Play's own updater, not an in-app one, now reaches every device. | — |
| 4 | **TASK-257** — Android *Tag beschreiben* never says the phone has no NFC | An operator stands at a door holding a card against a phone that will never read it, while the screen tells them to keep holding it. The sibling screen gets this right. | O · no-NFC device, both buttons |
| 5 | **TASK-189** — an Android cleaner cannot see their own hours | A worker on a new phone sees "no shifts yet" and zero hours even though the office holds every minute — the exact thing that makes a cleaner fear they will be paid wrong. | W · after SMS re-sign-in |
| 6 | **TASK-258** — Android has no in-app language switch | The app is German with no button anywhere to change it; a worker who cannot read German has a wall with no visible door, on every screen, permanently. | W · Einstellungen, read end to end |
| 7 | **TASK-259** — the zone panel never says which screen does a *Testscan* | The owner is told a card must be tested on site and by whom, but not on which app screen, so onboarding a building stalls on a phone call. | A · zone verify step |
| 8 | **TASK-251** — every building exposes a building-level tag, not just the grandfathered one | The panel hands the owner a copyable tap URL for buildings that were never meant to have one, which makes the whole test-scan gate look optional. | filed live during UAT |
| 9 | **TASK-253** — neither app shows its version in Settings | "Which version are you on?" is unanswerable without developer tooling, on a pilot where builds change weekly. | filed this session |
| 10 | **TASK-219** — a deactivated operator can never be brought back | Deactivating the wrong person also burns their phone number for good, and the only repair is a developer with database access. | filed this session |
| 11 | **TASK-260** — the red unresolved-shift warning sits beside a just-sent shift | A cleaner who finished a normal day sees "Gesendet" and a red warning on the same screen and cannot tell whether the warning is about today. | W · landing screen + tap-out |
| 12 | **TASK-261** — the two tag screens are written in ASCII German (`pruefen`, `Buero`, `Tuer`) | 51 strings spell German without umlauts, one scroll below strings that spell it correctly; a native reader reads it as unfinished, on the two highest-consequence screens. | O · `res/values/strings.xml` |
| 13 | **TASK-262** — establish whether a worker can be silently signed out mid-shift | Mostly explained by test-environment noise, but if it can happen for real, a cleaner alone in a building at 06:00 needs a code from the office to get back in. | W · two unexplained bounces, re-verified clean afterwards |
| 14 | **TASK-263** — iOS *Test a tag* opens a screen called *Testscan* | One action with two names, for a user who is checking mid-tap that they opened the right thing. Do it with TASK-256, same files. | O · iOS source read |
| 15 | **TASK-264** — a paused update says "waiting for internet" for three different reasons | Sends the worker chasing WiFi when WiFi is not the problem, and there is no retry button until the download gives up entirely. | W · Settings, update published |
| 16 | **TASK-265** — two buttons in the building flow both read *Objekt anlegen* | Harmless for a mouse, a real trap for support scripts, browser checks and a screen reader announcing the same name twice. | A · building wizard |
| 17 | **TASK-266** — "Mindestens 0 m²" claims a measurement of zero | Says a brand-new building measures nothing, when it means nothing has been measured. Same family as TASK-180. | A · after first zone created |
| 18 | **TASK-267** — the sign-in screen buries one field under five paragraphs | The first screen a new hire ever sees reads as a document rather than a one-tap sign-in. Lowest item in the pass. | W · first launch |

**Not refiled — already open, referenced instead**

| Suggestion | Existing task | Why it is the same thing |
|---|---|---|
| Verlauf / Zuletzt should pull history from the server | **TASK-189** | Same root and same fix: `Api.kt` never calls `GET /shifts/mine`, which iOS already does. The journey adds fresh evidence — after an SMS re-sign-in, a worker with months of history sees "Noch keine abgeschlossenen Schichten". |
| Stop raw `geocode_status` tokens on the dashboard | **TASK-181** | Names the same line, the same file and the same four statuses, including that production ships with no Maps key so `no_key` is the default state and not an edge case. |
| Fix the shared Mac's demo-stack port contention | **TASK-210** | Same failure, different resource: overlapping agent runs sharing one machine's fixed ports. TASK-210 AC #3 already asks for per-run ports or orphan detection; the `adb reverse tcp:443` case belongs there. |

---

## What could NOT be exercised — merged coverage gaps

Read this before treating anything above as fully proven, and before treating anything
absent from it as fully clear.

**No real NFC hardware anywhere in this pass.**
The ts-demo emulator has no NFC radio at all. Every worker tap was simulated with the exact
`ACTION_VIEW` intent the OS delivers after a real read; the radio and antenna path is
untested. No card was physically written or test-scanned — the write and verify screens were
covered through the debug-only scenario pickers (`WriteSimulation.kt`, `VerifySimulation.kt`,
confirmed release-gated by the `src/debug` vs `src/release` source-set split) and through
`strings.xml`. TASK-222 remains the task that closes this against real cards.

**iOS was never executed.**
`WriteTagScreen.swift`, `VerifyZoneScreen.swift` and the passive tap-arrival path
(`TapInbox` / `onOpenURL`) cannot run in Simulator — CoreNFC is hardware-only, and
`DemoHooks.swift` reaches the worker tap path, not an operator `NFCTagReaderSession`.
**Everything reported for iOS is a source read**, including TASK-256 and TASK-263 — though
both were confirmed by loading `Localizable.xcstrings` as JSON and looking the literals up,
not by inference. TASK-249 remains the task that puts this on a real iPhone.

**No real SMS was ever sent or received.**
Both the worker SMS sign-in and the admin panel's "SMS senden" ran against a local
Twilio-shaped stub, with the OTP read off the stub. On the admin stack SMS was deliberately
unconfigured, and the panel correctly disabled the control and said so — which also means
the actual message text a worker receives has never been seen. Arrival time, which app it
lands in, and what the notification looks like are all unverified.

**The self-update install path was never reached.**
Android's `DownloadManager` never even requested the APK against the demo's self-signed
certificate — believed to be a demo-TLS artefact that cannot occur against a real
certificate, but not independently confirmed. So "ready to install" and the install prompt
are untested, and TASK-264's confirmed half is the *copy and controls*, not the download
itself.

**The manual-fallback surfaces never rendered.**
Because the emulator reports `NfcReadiness.UNSUPPORTED`, the in-app *Tag manuell scannen* /
*Tag beschreiben* / *Tag prüfen* buttons on the signed-in log screen never appeared and could
not be observed at all.

**Never captured a signed-in operator past the Betreiber-Code gate on a live screen.**
A concurrent unrelated process kept re-pointing the emulator's `adb reverse tcp:443` at a
different local stack. The `POST /auth/operator-code` mechanism itself was proven correct by
direct curl (200 + session) against the explorer's own server — this is an infra gap, not a
suspected product defect. Same contention produced the two unexplained sign-outs behind
TASK-262 and one queued offline tap-out, and is why that task is filed as an investigation
rather than a bug.

**Flows deliberately not opened.**
The 8h auto-close resolution dialog (visible throughout as the red card, never opened);
operator sign-out and enrolment-code expiry/revocation; editing or deactivating a worker or
operator; the "auch Mitarbeiter" operator-is-also-a-worker linking path; the building
wizard's error paths (duplicate Kurzkürzel, invalid inline client, cancelling mid-wizard);
`/contracts/`, `/analytics/`, `/inventory/`, `/clients/`, `/material-requests/`.

**Out of scope for this pass.**
Accessibility (TalkBack / VoiceOver), tablet and foldable layouts, dark and high-contrast
theming on the phone apps. Text entry ran through `adb shell input text`, not a human on a
soft keyboard.

**Housekeeping.** The shared local `nfc_demo` database carries a little stray state from
early exploratory taps — re-run `psql -d nfc_demo -f demo/seed.sql` before the next clean
pass. Harmless and local-only.
