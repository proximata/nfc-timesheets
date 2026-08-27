// Runnable check: feature flags default to OFF, and the fun-theme motion stays on screen.
//
//   cd NFCTimeSheets && cat NFCTimeSheets/FeatureFlags.swift checks/flags-check.swift \
//     > /tmp/f.swift && swift /tmp/f.swift
//
// decision-57's whole safety argument is "OFF is bit-for-bit today's app". That argument is
// worth exactly as much as the code that decides what OFF means, so it is asserted here: an
// unknown flag name, a defaults store nobody ever wrote, and a server that never answered
// all have to read false.
//
// The motion is checked because a wrapping walk is the kind of arithmetic that looks right
// and drifts: a phase that leaves 0..<1 puts a figure off screen for a whole cycle, and
// figures that share a phase bunch into one blob.

import Foundation

var failed = false
func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        failed = true
    }
}

let defaults = UserDefaults(suiteName: "flags-check")!
defaults.removePersistentDomain(forName: "flags-check")

// --- OFF is the default, in every direction ---
check(FeatureFlags.enabled(FeatureFlags.funShiftScreen, in: defaults) == false,
      "a flag nobody has ever fetched reads OFF (a server that never answers may not change the screen)")
check(FeatureFlags.enabled("some_flag_the_server_invented", in: defaults) == false,
      "an unknown flag name reads OFF")

FeatureFlags.store([FeatureFlags.funShiftScreen: true], into: defaults)
check(FeatureFlags.enabled(FeatureFlags.funShiftScreen, in: defaults) == true,
      "a flag the server turned on reads ON")
FeatureFlags.store([FeatureFlags.funShiftScreen: false], into: defaults)
check(FeatureFlags.enabled(FeatureFlags.funShiftScreen, in: defaults) == false,
      "a flag the server turned back OFF reads OFF again - flags are not one-way")

check(FeatureFlags.defaultsKey("x") == "flag.x",
      "flag keys are namespaced, so a flag can never collide with an app preference")

// --- the walk stays on screen and stays spread out ---
var phases: [Double] = []
for figure in 0..<FunShiftAnimation.figureCount {
    for step in 0...200 {
        let t = Double(step) * 0.37 - 20        // negative time included on purpose
        let p = FunShiftAnimation.walkPhase(figure: figure, at: t)
        check(p >= 0 && p < 1, "walkPhase(figure: \(figure), at: \(t)) = \(p) is outside 0..<1")
        let swing = FunShiftAnimation.sweepSwing(figure: figure, at: t)
        check(swing >= -1 && swing <= 1, "sweepSwing out of range: \(swing)")
    }
    phases.append(FunShiftAnimation.walkPhase(figure: figure, at: 0))
}
check(Set(phases).count == FunShiftAnimation.figureCount,
      "every figure starts at its own phase - a shared phase draws one blob, not a crew")

if failed {
    FileHandle.standardError.write(Data("flags-check: FAILED\n".utf8))
    exit(1)
}
print("flags-check: OK (\(FunShiftAnimation.figureCount) figures, flags default OFF)")
