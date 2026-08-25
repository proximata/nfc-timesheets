// Runnable check: the NFC entitlement never regains the format that got it rejected once.
//
//   cd NFCTimeSheets && swift checks/entitlement-format-check.swift
//
// decision-49: com.apple.developer.nfc.readersession.formats must read TAG and ONLY TAG.
// "NDEF" is App Store error 90778 against the iOS 26 SDK — the rejection that removed this
// capability the first time (docs/NFC-WRITE-SETUP.md). It does not fail locally: a Release
// build with NDEF present compiles and code-signs fine (measured, TASK-246 Verify phase) and
// only bounces back from App Store review, days later, as a rejection with no local repro.
// So "read the array before you build" (the doc's own step 4) is a human instruction with no
// enforcement behind it — this file is that enforcement, wired into checks/run.sh so every
// Build/Verify-phase workflow that already runs it gets this for free.
//
// This has now regressed for real TWICE: once historically (why decision-49/this doc exist
// at all) and once live on 2026-08-25, when NDEF was added back locally while testing
// read+write and only caught because someone happened to read the diff before it was
// committed. A third time without a human happening to look is exactly what this prevents.
//
// The entitlement file is the OWNER's, per decision-49 — this check only READS it, never
// writes it, and stays green with the capability OFF entirely (key absent is a valid state).

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

let path = "NFCTimeSheets/NFCTimeSheets.entitlements"
guard let data = FileManager.default.contents(atPath: path),
      let root = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
else {
    FileHandle.standardError.write(Data("FAIL: \(path) is missing or is not a property list\n".utf8))
    exit(1)
}

let key = "com.apple.developer.nfc.readersession.formats"
if let formats = root[key] {
    guard let array = formats as? [String] else {
        check(false, "\(key) is present but is not a string array")
        exit(failed ? 1 : 0)
    }
    check(array == ["TAG"], "\(key) is \(array) — must be exactly [\"TAG\"]. \"NDEF\" is App Store error "
          + "90778 against the iOS 26 SDK (docs/NFC-WRITE-SETUP.md). If Xcode added NDEF when you ticked "
          + "the capability, delete that line.")
} else {
    // Capability off entirely is the shipped-today state (decision-49) — nothing to check.
}

if failed {
    exit(1)
}
print("entitlement-format-check: OK")
