//
//  ShiftSignal.swift
//  NFCTimeSheets
//
//  What the app believes about the shift in progress, and everything that follows from
//  it: which tabs exist, which out-of-app signals are armed, when the reminders fire.
//
//  FOUNDATION ONLY, on purpose. No SwiftUI, no UserNotifications, no ActivityKit. That
//  is what lets checks/shift-signal-check.swift cat this file and run it on a Mac with
//  no Xcode, no simulator and no phone - the same trick TagLink.swift and TapInbox.swift
//  already use. Every rule that decides whether a worker is reminded to tap out lives
//  here, where it can be proven; the platform plumbing lives in ShiftSignalCenter.swift,
//  where it cannot.
//
//  Mirrored one-for-one by android/.../core/ShiftSignal.kt. The two files are the same
//  state machine written twice, and android/checks/core-check.kt asserts the constants
//  agree - the whole point of this work is that the two platforms behave the same.
//

import Foundation

// MARK: - What the app believes

/// The open shift, as the app currently understands it. Built from the LOCAL SwiftData
/// row, which is what a tap in a basement writes - never from a server response, because
/// there may not have been one.
///
/// This is the single value the signal is armed from (audit §4): the tap path and
/// `adoptServerOpenShift` both end up calling `ShiftSignalCenter.arm(for:)` with one of
/// these, so a reinstalled phone re-arms exactly like a fresh clock-in does.
struct RunningShift: Equatable {
    let locationId: String
    /// May be the "unknown location" fallback: the roster cache is filled by the network
    /// and a tag tap does not wait for it. A missing NAME is cosmetic; a missing SHIFT is
    /// unpaid work. Nothing here branches on it.
    let locationName: String
    let startTime: Date
    /// The server has already flagged this shift as auto-closed and no human has
    /// confirmed the real finish time (decision-10). Forces `.overdue` regardless of the
    /// clock: a shift the server has closed must never be shown with a running timer.
    let serverAutoClosed: Bool

    init(locationId: String, locationName: String, startTime: Date, serverAutoClosed: Bool = false) {
        self.locationId = locationId
        self.locationName = locationName
        self.startTime = startTime
        self.serverAutoClosed = serverAutoClosed
    }
}

/// Two phases and no more. `running` is a normal shift; `overdue` is one that has passed
/// (or been confirmed past) the 8h auto-close boundary and now needs a human.
enum ShiftPhase: String, Equatable {
    case running
    case overdue
}

// MARK: - The lock

/// The tabs that exist. NOT a security boundary and NOT a kiosk - a WORK-DISCIPLINE
/// shape. While a shift runs the app has one job and looks like it. Anyone reading this
/// later: do not mistake it for enforcement. The worker can sign out, resolve an
/// auto-closed shift, ask for material and read the help text at every moment, and every
/// one of those is a labelled tab rather than a gesture or a PIN.
enum AppTab: String, CaseIterable {
    case log
    case materials
    case history
    case settings
}

enum ShiftSignal {

    // MARK: Constants shared with the server's 8h timer

    /// ops/sql/autoclose.sql closes an open shift at start + 8h and the systemd timer
    /// runs it every 15 minutes (decision-10). The client computes the same boundary
    /// LOCALLY and never asks the server for it: a clock-in works offline, so a
    /// server-supplied deadline would be a second mechanism the client cannot rely on.
    /// One constant on each side, both pinned by checks.
    static let autoCloseAfter: TimeInterval = 8 * 3600

    /// Escalating reminders, in hours after the start. The last rung is the auto-close
    /// itself, so its wording is different - see `isAutoCloseWarning`.
    ///
    /// One-shot requests, not a repeating trigger: `UNTimeIntervalNotificationTrigger`
    /// with `repeats: true` demands >= 60s and then says the same thing forever, and
    /// "Sie sind seit 5 Stunden eingestempelt" is worth more than eight identical pings.
    /// Eight pending requests is nowhere near the system's 64-soonest ceiling.
    static let reminderHours: [Int] = [1, 2, 3, 4, 5, 6, 7, 8]

    /// The 8h rung is not "you have been clocked in for 8 hours", it is "the server has
    /// just closed this and you now have to confirm the real finish time".
    static func isAutoCloseWarning(hour: Int) -> Bool {
        TimeInterval(hour) * 3600 >= autoCloseAfter
    }

    // MARK: Phase

    static func phase(startTime: Date, now: Date, serverAutoClosed: Bool) -> ShiftPhase {
        if serverAutoClosed { return .overdue }
        return now.timeIntervalSince(startTime) >= autoCloseAfter ? .overdue : .running
    }

    static func phase(of running: RunningShift, now: Date) -> ShiftPhase {
        phase(startTime: running.startTime, now: now, serverAutoClosed: running.serverAutoClosed)
    }

    /// The moment the server's timer will close this shift. Used to bound the ticking
    /// clock so it stops at 8h instead of counting to infinity.
    static func autoCloseDeadline(after startTime: Date) -> Date {
        startTime.addingTimeInterval(autoCloseAfter)
    }

    // MARK: The lock

    /// History is the only thing that goes away, and nothing in it is time-critical.
    ///
    /// Materials stays because the worker is standing IN the building - that is exactly
    /// when they need it. Settings stays because a handed-over phone must be signable-out
    /// (decision-22/26). Log stays because it has become the shift screen. The resolver
    /// is not a tab: it is a banner on the Log tab and it is shown in EVERY state, which
    /// is what decision-10 requires.
    static func visibleTabs(shiftRunning: Bool) -> [AppTab] {
        shiftRunning ? [.log, .materials, .settings] : AppTab.allCases
    }

    // MARK: The permission moment

    /// NEVER on the clock-in path, and never before the first successful clock-in.
    ///
    /// The alternative was asking at launch, which means asking at a door at 06:02 with
    /// gloves on, before the worker has any idea what the app is for - and a "Don't
    /// Allow" there is permanent. Ask once, afterwards, from a screen that is already
    /// explaining what the reminder buys. A refusal is a weaker signal and one sentence,
    /// never a blocked tap and never a nag.
    static func shouldAskForNotifications(hasClockedIn: Bool, alreadyAsked: Bool) -> Bool {
        hasClockedIn && !alreadyAsked
    }

    // MARK: The plan

    /// Everything the OS should be showing right now, derived from one value.
    ///
    /// `plan(for: nil)` is `.idle` - every signal off. That is the invariant that keeps a
    /// closed shift from leaving a badge on the home screen or a Live Activity on the
    /// lock screen, and it is why the arming call is unconditional rather than guarded by
    /// "did something change".
    struct SignalPlan: Equatable {
        /// The Log tab renders the full-bleed shift screen instead of the list.
        let lockScreen: Bool
        /// The app-icon badge. AN OPEN SHIFT OWNS THE APP-ICON BADGE; materials never
        /// touch it - the icon badge carries one number and two owners would fight over
        /// it. The Materials TAB badge is a different thing and does not collide.
        let badgeCount: Int
        /// The +1h..+8h ladder is pending.
        let remindersScheduled: Bool
        /// A Live Activity should be running. Inert until the owner adds the widget
        /// extension target (docs/LIVE-ACTIVITY-SETUP.md); the controller no-ops.
        let liveActivity: Bool
        let phase: ShiftPhase?

        static let idle = SignalPlan(lockScreen: false, badgeCount: 0,
                                     remindersScheduled: false, liveActivity: false, phase: nil)
    }

    static func plan(for running: RunningShift?, now: Date) -> SignalPlan {
        guard let running else { return .idle }
        let phase = phase(of: running, now: now)
        return SignalPlan(
            lockScreen: true,
            // Still 1 when overdue: the shift is still the only thing this app is about,
            // and the worker still has to act - harder now, not less.
            badgeCount: 1,
            // Past 8h every rung has already fired and the server has closed the shift.
            // Re-arming would ping somebody about a shift that no longer exists.
            remindersScheduled: phase == .running,
            // ActivityKit hard-ends a Live Activity at 8 hours - exactly the auto-close
            // window. There is no extension and asking for one past the boundary is a
            // request the system refuses. Do not promise "it stays until you tap out".
            liveActivity: phase == .running,
            phase: phase
        )
    }

    // MARK: Spoken duration

    /// Hours and minutes, for the ONE static accessibility element that carries the
    /// elapsed time.
    ///
    /// The ticking text on screen is `accessibilityHidden`. A per-second live region
    /// makes VoiceOver unusable, and a locked screen whose only content is a timer is
    /// precisely where that bug would be worst. The label is recomputed once a minute by
    /// a TimelineView, which updates the label without announcing anything.
    static func elapsed(from startTime: Date, to now: Date) -> (hours: Int, minutes: Int) {
        let seconds = max(0, Int(now.timeIntervalSince(startTime)))
        return (seconds / 3600, (seconds % 3600) / 60)
    }
}
