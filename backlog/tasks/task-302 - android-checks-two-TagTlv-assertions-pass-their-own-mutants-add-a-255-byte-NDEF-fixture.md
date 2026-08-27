---
id: TASK-302
title: >-
  android/checks: two TagTlv assertions pass their own mutants - add a >255-byte
  NDEF fixture
status: To Do
assignee: []
created_date: '2026-08-27 11:31'
labels:
  - android
  - decision-58
  - checks
dependencies: []
priority: medium
ordinal: 220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-297 review gate by mutating TagTlv.kt in a throwaway copy and re-running core-check.

TWO MUTANTS SURVIVE, i.e. two assertions do not test what their comments say:

1. Delete the guard 'if (length < LONG_FORM) return null' in TagTlv.ndefMessage -> core-check still passes. Its fixture, byteArrayOf(0x03, 0xFF, 0x00, 0x10, 0x01), is ALSO refused by the runs-past-the-end rule (valueAt 4 + length 16 > size 5), so the assertion 'a 3-byte length that would fit in one byte is a card written by something confused' never exercises the guard it names.

2. Replace the 16-bit read with 'length = data[i + 3].toInt() and 0xFF' (high byte ignored) -> core-check still passes, because the long fixture's high byte is 0x00 (length 0x00FF = 255). The comment claims the fixture 'proves the walker reads the 16-bit length'; it only proves it does not read the 0xFF marker byte as the length.

FIX. Add one fixture with a length above 255, e.g. 256 written as 03 FF 01 00 followed by 256 bytes: it kills mutant 2 outright. For mutant 1, add a short-value long-form fixture whose length also FITS in the buffer, e.g. 03 FF 00 04 de ad be ef, which is refused only by the guard.

WHY IT MATTERS AT ALL, AND WHY IT IS NOT URGENT. Our own message is ~64 bytes, so this app never writes the long form; it only ever appears on a foreign card being diagnosed. The bytes come off an unlocked, attacker-writable card (decision-15), so the walker's refusals are a trust boundary and should be pinned.

ACCEPTANCE EVIDENCE. Both mutations above, applied to a scratch copy, must make android/checks/run.sh print a FAIL line; unmutated, it stays green.
<!-- SECTION:DESCRIPTION:END -->
