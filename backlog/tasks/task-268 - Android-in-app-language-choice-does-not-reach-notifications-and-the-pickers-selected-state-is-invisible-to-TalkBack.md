---
id: TASK-268
title: >-
  Android: in-app language choice does not reach notifications, and the picker's
  selected state is invisible to TalkBack
status: In Progress
assignee: []
created_date: '2026-08-24 20:13'
updated_date: '2026-08-25 14:49'
labels:
  - android
  - i18n
  - a11y
  - ux
dependencies: []
priority: medium
ordinal: 186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: verify pass on TASK-258 at 6a104a3. Both are outside TASK-258's acceptance criteria, which all passed; both are real and small.

1. NOTIFICATIONS STAY ON THE OS LOCALE. notify/ShiftSignals.kt resolves every user-visible string through context.applicationContext (lines 85, 90-105, 181) - notify_running_title, notify_running_body, notify_overdue_*, unknown_location. AppLocale.wrap() is installed in attachBaseContext on the four UI Activities ONLY, and the Application object is deliberately untouched. Measured consequence: a worker who picks English in Einstellungen gets an English app and German shift reminders. The reverse also holds on an English-OS phone that picks Deutsch. FIX SHAPE: resolve those strings through AppLocale.wrap(app) at the point of use in ShiftSignals - do NOT wrap TimeSheetsApplication itself and do NOT touch NfcTapActivity, the tap path stays exactly as it is (android/checks/core-check.kt must still pass unchanged).

2. THE PICKER'S CURRENT CHOICE IS VISUAL ONLY. ui/TimeSheetApp.kt LanguageSection() marks the active language by rendering Button instead of OutlinedButton. Nothing carries Modifier.semantics { selected = true } and the Row is not a selectableGroup(), so TalkBack announces three identical buttons and never says which language is currently active - the one screen a worker who cannot read the current language most needs to operate by ear. FIX SHAPE: selectableGroup() on the Row plus selected/Role.RadioButton semantics per option; keep the visual treatment as is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Notification copy follows the in-app language choice, not the OS locale
- [x] #2 android/checks/core-check.kt still passes and NfcTapActivity is unmodified
- [ ] #3 TalkBack announces which language is currently selected in the picker
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Committed 687f983 (android/ only; NFCTimeSheets/ untouched).

FIX 1: ShiftSignals.strings(context) = AppLocale.wrap(applicationContext), resolved at point of use, never cached. Used in arm(), scheduleLadder(), postReminder(), ensureChannel(), and Receivers.kt's unknown_location fallback.
FIX 2: LanguageSection Row gets selectableGroup(); each button gets semantics { selected = isSelected; role = Role.RadioButton }. Visual treatment unchanged.

=== INDEPENDENT VERIFY PASS (second agent, emulator seg_bt_api30 / API 30, adb root) ===

AC1 TICKED. Proven at RUNTIME, both directions, with a pre-fix negative control on the SAME
device and the SAME persisted picker value. Reminder rung fired with
  am broadcast -n io.github.qwadratic.NFCTimeSheets/io.github.qwadratic.nfctimesheets.notify.ShiftReminderReceiver --ei hour N --es location 'Hauptstrasse 1'
then read back with dumpsys notification --noredact:
  POST-FIX  OS=de-AT + picker=English -> 'Still clocked in' / '5 h at Hauptstrasse 1. Hold your phone to the tag to finish.'   (values-en)
  POST-FIX  OS=en-US + picker=Deutsch -> 'Noch eingestempelt' / '7 Std. bei Hauptstrasse 1. Halten Sie Ihr Telefon an den Tag, um zu beenden.'   (values)
  POST-FIX  OS=en-US + picker=Deutsch, hour=8 -> 'Schicht automatisch beendet' / German autoclose body (isAutoCloseWarning branch)
  POST-FIX  channel name flipped live to 'Laufende Schicht' on an en-US OS -> ensureChannel() follows the picker too
  PRE-FIX (687f983^, built in a throwaway git worktree, installed over the same data dir)
            OS=en-US + picker=Deutsch -> 'Still clocked in' / '6 h at ...'  = OS locale wins. THE BUG WAS REAL.
NOT exercised at runtime: the ONGOING notification (notify_running_*/notify_overdue_*/unknown_location in arm()).
It needs an open shift, which needs a real NFC tap. It calls the SAME strings() helper in the
same file as the three string groups that were proven, so the mechanism is covered, the
specific string ids are not. If anyone wants belt-and-braces, tap a real tag once and read the
ongoing notification.

AC2 TICKED (re-verified independently, not taken on trust).
  android/checks/run.sh -> core-check OK, known-tags-check OK, tag-writer-check OK, manifest-check OK,
  verify-no-shift-check OK, update-reach-check OK (6/6, run twice).
  NfcTapActivity.kt blob 92527589146e595cacfb889f5d56683c81302545 is IDENTICAL at 687f983^, at 687f983
  and in the worktree - byte-identical, not merely absent from the diff.
  :app:assembleDebug BUILD SUCCESSFUL. node ops/check-branding.mjs -> check-branding: OK, one
  pre-existing TODO unrelated to this task: iOS is still associated with the RENAMEABLE host
  schimmer-glanz.exe.xyz, not the permanent tag host timesheets.exe.xyz (TASK-188).

AC3 NOT TICKED - TalkBack itself was never run. The AOSP system image has no screen reader at
all (pm list packages | grep talkback -> empty; cmd accessibility list -> empty), so no
announcement could be transcribed. What WAS proven on device, via uiautomator dump, is the
AccessibilityNodeInfo state that is TalkBack's only input:
  PRE-FIX  all three options: checkable=false checked=false selected=false  -> three identical Views, no state at all
  POST-FIX exactly one option: checkable=true checked=true; the other two checkable=true checked=false;
           tapping a different language moves checked=true to it
NOTE FOR WHOEVER FINISHES THIS: Compose maps semantics{selected} + Role.RadioButton onto
isCheckable/isChecked + a stateDescription, NOT onto AccessibilityNodeInfo.isSelected - the dump
shows selected=false on every option and that is CORRECT, not a bug. Do not 'fix' it.
REMAINS: one phone with TalkBack, open the Sprache picker, transcribe the announcement; it must
name the active option. 'button' vs 'radio button' both fine. Neither the collection index
('2 of 3', from selectableGroup) nor the stateDescription is visible to uiautomator dump, so
those two are the only genuinely unverified parts.
<!-- SECTION:NOTES:END -->
