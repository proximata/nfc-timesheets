// Runnable check: decision-62's cache-generation marker. No test framework, no Xcode.
//
//   cd NFCTimeSheets && cat NFCTimeSheets/AppUpdate.swift checks/app-update-check.swift \
//     > /tmp/c.swift && swift /tmp/c.swift
//
// WHAT WOULD GO WRONG WITHOUT IT. The two failures this arithmetic has to avoid are
// opposite and both silent:
//   - answering true on EVERY launch: the roster is thrown away and re-fetched constantly,
//     so a phone with no signal shows "Unknown location" for a building it knew yesterday.
//   - answering true on a FRESH INSTALL: nothing is cached yet, so the invalidation is
//     pure cost - and it would fire on exactly the launch that is already slowest.
// Neither is visible in a screenshot, which is why it is arithmetic in its own file.
//
// RED CASE: drop the `defaults.set(current, ...)` line in AppUpdate and the second-call
// assertion below fails.

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

func fresh() -> UserDefaults {
    let d = UserDefaults(suiteName: "app-update-check-\(UUID().uuidString)")!
    d.removeObject(forKey: AppUpdate.defaultsKey)
    return d
}

// A fresh install has nothing cached, so there is nothing to invalidate.
let first = fresh()
check(AppUpdate.didChangeBuild(current: "11", defaults: first) == false,
      "a fresh install is not an update")
check(first.string(forKey: AppUpdate.defaultsKey) == "11",
      "the first launch still RECORDS the build, or every later launch looks like an update")

// Same build again: nothing happened.
check(AppUpdate.didChangeBuild(current: "11", defaults: first) == false,
      "relaunching the same build is not an update")

// A new build, once - and exactly once.
check(AppUpdate.didChangeBuild(current: "12", defaults: first) == true,
      "a changed CFBundleVersion is an update")
check(AppUpdate.didChangeBuild(current: "12", defaults: first) == false,
      "the SAME update does not fire twice - the new build is recorded as a side effect")

// A DOWNGRADE (a TestFlight rollback, an older build side-loaded) is still a change: the
// cached reads on the phone came from a version that is no longer running.
check(AppUpdate.didChangeBuild(current: "11", defaults: first) == true,
      "a downgrade also invalidates - 'different', not 'newer'")

if failed { exit(1) }
print("app-update-check: OK")
