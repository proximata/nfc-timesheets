// Runnable check: the in-shift state machine. No test framework, no Xcode, no simulator.
//
//   cd NFCTimeSheets
//   cat NFCTimeSheets/ShiftSignal.swift checks/shift-signal-check.swift \
//     > /tmp/shift-signal-check.swift && swift /tmp/shift-signal-check.swift
//
// Four things are pinned here, and every one of them is a way this feature could quietly
// cost somebody money:
//
//   1. THE STATE MACHINE. A shift opens -> the lock, the badge, the ladder and the Live
//      Activity are on. It closes -> every one of them is off. Past 8h -> the clock stops
//      being a running clock, because the server has already closed that row.
//   2. THE LOCK NEVER TRAPS ANYBODY. Materials and Settings are in visibleTabs in EVERY
//      state, so sign-out (decision-22) and asking for supplies stay reachable.
//   3. THE PERMISSION PROMPT IS NEVER ON THE TAP PATH. Not before the first clock-in,
//      not twice.
//   4. THE TAP IS NEVER BLOCKED BY A SIGNAL. Read out of ContentView.swift as text,
//      because that ordering lives in SwiftUI code this runner cannot import: the local
//      row is written and SAVED before arm(for:) is called, and arm() is not awaited.
//      A cache miss is not a rejection - that bug already cost this project a dead tap.
//
// Mirrored by android/checks/core-check.kt section 13. The two platforms are supposed to
// behave the same; if one of these files changes alone, that has stopped being true.

import Foundation

func check(_ ok: Bool, _ what: String) {
    if !ok {
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
        exit(1)
    }
}

let start = Date(timeIntervalSince1970: 1_700_000_000)   // fixed, so nothing depends on "now"
func at(_ hours: Double) -> Date { start.addingTimeInterval(hours * 3600) }

let shift = RunningShift(locationId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
                         locationName: "Westbahnhof",
                         startTime: start)

// ---------------------------------------------------------------------------------
// 1. The state machine
// ---------------------------------------------------------------------------------

// A shift opens: everything on.
let opened = ShiftSignal.plan(for: shift, now: at(0.01))
check(opened.lockScreen, "an open shift puts the app into the locked shift screen")
check(opened.badgeCount == 1, "an open shift owns the app-icon badge")
check(opened.remindersScheduled, "an open shift schedules the reminder ladder")
check(opened.liveActivity, "an open shift asks for a Live Activity")
check(opened.phase == .running, "and it is running")

// A shift closes: everything off. This is the invariant that stops a closed shift
// leaving a badge on the home screen and a Live Activity on the Lock Screen.
let closed = ShiftSignal.plan(for: nil, now: at(3))
check(closed == ShiftSignal.SignalPlan.idle, "no open shift means the idle plan and nothing else")
check(!closed.lockScreen, "a closed shift unlocks the app")
check(closed.badgeCount == 0, "a closed shift clears the app-icon badge")
check(!closed.remindersScheduled, "a closed shift cancels the ladder")
check(!closed.liveActivity, "a closed shift ends the Live Activity")
check(closed.phase == nil, "a closed shift has no phase")

// The 8h boundary, computed LOCALLY. ops/sql/autoclose.sql closes at start+8h and the
// client must reach the same conclusion with no server round trip, because a clock-in
// works offline.
check(ShiftSignal.autoCloseAfter == 8 * 3600, "the auto-close boundary is 8 hours (decision-10)")
check(ShiftSignal.phase(startTime: start, now: at(7.99), serverAutoClosed: false) == .running,
      "7h59 is still running")
check(ShiftSignal.phase(startTime: start, now: at(8.0), serverAutoClosed: false) == .overdue,
      "exactly 8h is overdue - the server's timer has fired by then")
check(ShiftSignal.phase(startTime: start, now: at(8.01), serverAutoClosed: false) == .overdue,
      "8h01 is overdue")
check(ShiftSignal.autoCloseDeadline(after: start) == at(8), "the deadline is start + 8h")

// Past 8h: still locked, still badged, but no running clock and no new pings about a
// shift the server has already closed.
let overdue = ShiftSignal.plan(for: shift, now: at(9))
check(overdue.phase == .overdue, "past 8h the phase flips")
check(overdue.lockScreen, "...the screen stays - the worker still has to act")
check(overdue.badgeCount == 1, "...and so does the badge")
check(!overdue.remindersScheduled, "...but nothing new is scheduled: every rung has fired")
check(!overdue.liveActivity,
      "...and no Live Activity is requested past 8h - ActivityKit hard-ends it there anyway")

// THE AUTO-CLOSED SHIFT MUST NOT LEAVE A STUCK LOCK. Two halves, and both are needed.
// Half one: the server says auto_closed while the local row is still open. The clock
// stops being a running clock immediately, whatever the wall time says.
let serverClosed = RunningShift(locationId: shift.locationId, locationName: shift.locationName,
                                startTime: start, serverAutoClosed: true)
check(ShiftSignal.phase(of: serverClosed, now: at(0.5)) == .overdue,
      "a server-flagged auto-close is overdue after 30 minutes, not after 8 hours")
let flagged = ShiftSignal.plan(for: serverClosed, now: at(0.5))
check(!flagged.liveActivity && !flagged.remindersScheduled,
      "a shift the server has closed never shows a running timer or schedules a reminder")
// Half two: the worker confirms the finish time, the row closes, arm(for: nil) runs, and
// there is nothing left anywhere. Same value as a normal tap-out - one code path.
check(ShiftSignal.plan(for: nil, now: at(9)) == ShiftSignal.SignalPlan.idle,
      "resolving an auto-closed shift leaves no lock, no badge, no notification")

// ---------------------------------------------------------------------------------
// 2. The lock never traps anybody
// ---------------------------------------------------------------------------------

for running in [true, false] {
    let tabs = ShiftSignal.visibleTabs(shiftRunning: running)
    check(tabs.contains(.log), "the log tab exists whether or not a shift runs (\(running))")
    check(tabs.contains(.materials),
          "materials is reachable while a shift runs - that is exactly when it is needed (\(running))")
    check(tabs.contains(.settings),
          "settings, and therefore SIGN OUT, is reachable in every state (decision-22) (\(running))")
    check(!tabs.isEmpty, "there is always something to tap")
}
check(!ShiftSignal.visibleTabs(shiftRunning: true).contains(.history),
      "history is the one thing the lock hides - nothing in it is time-critical")
check(ShiftSignal.visibleTabs(shiftRunning: false) == AppTab.allCases,
      "with no shift running the app is exactly as it was")

// ---------------------------------------------------------------------------------
// 3. The permission prompt
// ---------------------------------------------------------------------------------

check(!ShiftSignal.shouldAskForNotifications(hasClockedIn: false, alreadyAsked: false),
      "NEVER ask before the first clock-in: that means asking at a door at 06:02 with gloves on")
check(ShiftSignal.shouldAskForNotifications(hasClockedIn: true, alreadyAsked: false),
      "ask once, afterwards, from the shift screen")
check(!ShiftSignal.shouldAskForNotifications(hasClockedIn: true, alreadyAsked: true),
      "and never again - a refusal is one sentence, not a nag")

// ---------------------------------------------------------------------------------
// 4. The ladder
// ---------------------------------------------------------------------------------

check(ShiftSignal.reminderHours == [1, 2, 3, 4, 5, 6, 7, 8], "eight rungs, one an hour")
check(ShiftSignal.reminderHours.count < 64,
      "well under the system's 'soonest-firing 64 notifications' ceiling")
check(!ShiftSignal.isAutoCloseWarning(hour: 7), "the 7h rung is a nudge")
check(ShiftSignal.isAutoCloseWarning(hour: 8),
      "the 8h rung is the auto-close itself and says something different")
check(ShiftSignal.reminderHours.allSatisfy { TimeInterval($0) * 3600 <= ShiftSignal.autoCloseAfter },
      "no rung fires after the server has closed the shift")

// ---------------------------------------------------------------------------------
// 5. Spoken duration - one label, not a per-second live region
// ---------------------------------------------------------------------------------

let spoken = ShiftSignal.elapsed(from: start, to: at(3) + 14 * 60 + 30)
check(spoken.hours == 3 && spoken.minutes == 14,
      "3h14m30s is spoken as 3 hours 14 minutes: the seconds are deliberately not in it")
let sameMinute = ShiftSignal.elapsed(from: start, to: at(3) + 14 * 60 + 59)
check(spoken == sameMinute,
      "the spoken label does not change within a minute, so VoiceOver is not spammed")
check(ShiftSignal.elapsed(from: start, to: start.addingTimeInterval(-60)) == (0, 0),
      "a phone whose clock jumped backwards reads 0h 0m, never a negative duration")

// ---------------------------------------------------------------------------------
// 6. THE TAP IS NEVER BLOCKED (audit R2), read out of ContentView.swift as text
// ---------------------------------------------------------------------------------
//
// This is the one check that must exist. The rest of this file proves the state machine
// is right; this proves it is armed from a place where it cannot cost anybody a clock-in.

let view = try! String(contentsOfFile: "NFCTimeSheets/ContentView.swift", encoding: .utf8)
let handleTap = view.components(separatedBy: "private func handleTap(")[1]
    .components(separatedBy: "private func outcome(")[0]

let save = handleTap.range(of: "try? context.save()")
let arm = handleTap.range(of: "signals.arm(")
check(save != nil, "handleTap still saves the local row")
check(arm != nil, "handleTap arms the signal")
check(save!.upperBound < arm!.lowerBound,
      "THE LOCAL ROW IS SAVED BEFORE ANY SIGNAL WORK. A tap in a basement counts even if "
      + "every signal fails; the reverse would lose paid time.")
check(!handleTap.contains("await signals."),
      "no signal call is awaited on the tap path - arm() is synchronous and non-throwing")
check(!handleTap.contains("requestAuthorization"),
      "the notification prompt is NEVER on the tap path (audit R3)")
check(!handleTap.contains("try await") || handleTap.range(of: "try await")!.lowerBound > save!.upperBound,
      "nothing that can throw runs before the row is saved")

// The recovery half of the same wire: adopting a shift the server knows about and this
// phone does not must arm exactly like a fresh tap does (audit §4).
let refresh = view.components(separatedBy: "private func refresh() async {")[1]
    .components(separatedBy: "\n    }")[0]
check(refresh.contains("adoptServerOpenShift"), "refresh still adopts the server's open shift")
check(refresh.contains("signals.arm("),
      "...and re-arms from it, so a reinstalled or rebooted phone gets its signal back")

// TEARDOWN TAKES BACK WHAT WAS ALREADY DELIVERED, not just what is still scheduled.
// A shift that closed at 07:40 leaving the 07:00 "Still clocked in" banner in Notification
// Center is worse than no signal at all: it tells somebody who has finished that they have
// not. Android cancels its delivered reminder by id; this is the iOS half.
let center = try! String(contentsOfFile: "NFCTimeSheets/ShiftSignalCenter.swift", encoding: .utf8)
check(center.contains("removePendingNotificationRequests(withIdentifiers: Self.allReminderIds)"),
      "tearing down cancels the scheduled rungs")
check(center.contains("removeDeliveredNotifications(withIdentifiers: Self.allReminderIds)"),
      "...AND removes the rungs already sitting in Notification Center - a stale "
      + "'you are still working' notification is worse than none")

// The badge has ONE owner. Two writers would fight over a surface that carries one number.
let materials = try! String(contentsOfFile: "NFCTimeSheets/MaterialStore.swift", encoding: .utf8)
check(!materials.contains("setBadgeCount"),
      "materials never touch the APP-ICON badge - the open shift owns it (the tab badge is a different surface)")

print("shift-signal-check: OK")
