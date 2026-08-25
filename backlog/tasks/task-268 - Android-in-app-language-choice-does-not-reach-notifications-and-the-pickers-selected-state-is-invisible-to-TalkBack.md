---
id: TASK-268
title: >-
  Android: in-app language choice does not reach notifications, and the picker's
  selected state is invisible to TalkBack
status: To Do
assignee: []
created_date: '2026-08-24 20:13'
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
- [ ] #1 Notification copy follows the in-app language choice, not the OS locale
- [ ] #2 android/checks/core-check.kt still passes and NfcTapActivity is unmodified
- [ ] #3 TalkBack announces which language is currently selected in the picker
<!-- AC:END -->
