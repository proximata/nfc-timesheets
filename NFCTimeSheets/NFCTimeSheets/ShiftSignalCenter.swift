//
//  ShiftSignalCenter.swift
//  NFCTimeSheets
//
//  The platform plumbing behind ShiftSignal.swift: the app-icon badge, the escalating
//  local-notification ladder, and the Live Activity bridge.
//
//  THE ONE RULE THIS FILE EXISTS TO OBEY: clocking in is never blocked. `arm(for:)` is
//  synchronous, non-throwing, and returns before anything touches the OS. Every call it
//  makes is fire-and-forget inside a Task, every failure is swallowed, and a denied
//  permission arms nothing and rejects nothing. A cache miss is not a rejection - that
//  bug already cost this project a dead tag tap.
//
//  ONE WIRE (audit §4). Both the tap path (LogView.handleTap) and the recovery path
//  (LogView.refresh, after adoptServerOpenShift) call arm(for:) with the same value, so a
//  reinstalled phone, a rebooted phone and a fresh clock-in all end up in the same state.
//

import Foundation
import UserNotifications

@MainActor
@Observable
final class ShiftSignalCenter {

    static let shared = ShiftSignalCenter()

    /// The system's answer, refreshed on launch and after every prompt. `.notDetermined`
    /// until we look.
    private(set) var authorization: UNAuthorizationStatus = .notDetermined

    /// The shift the last `arm` was given, so a permission grant landing mid-shift can
    /// re-arm without the caller handing it over again.
    private(set) var running: RunningShift?

    /// True once this phone has produced at least one clock-in. The permission prompt is
    /// gated on it (ShiftSignal.shouldAskForNotifications) so nobody is asked at a door
    /// before they have any idea what the app does.
    private(set) var hasClockedIn = UserDefaults.standard.bool(forKey: Keys.hasClockedIn)

    private var alreadyAsked = UserDefaults.standard.bool(forKey: Keys.askedForNotifications)

    private enum Keys {
        static let hasClockedIn = "signalHasClockedIn"
        static let askedForNotifications = "signalAskedForNotifications"
    }

    /// Identifier prefix for the ladder. One pair of removals with these ids clears the
    /// lot on tap-out - the scheduled ones AND the ones already on the Lock Screen.
    private static func reminderId(hour: Int) -> String { "shift-reminder-\(hour)h" }
    private static var allReminderIds: [String] { ShiftSignal.reminderHours.map(reminderId(hour:)) }

    private init() {}

    // MARK: - The wire

    /// Arm every out-of-app signal for `running`, or tear all of them down when it is nil.
    ///
    /// Unconditional and idempotent on purpose: it is cheaper to re-state the world than
    /// to track what changed, and "did anything change" is exactly the kind of bookkeeping
    /// that leaves an orphaned badge on the home screen after an auto-close.
    ///
    /// NOTHING HERE IS AWAITED BY THE CALLER. It is called after the local row has been
    /// written and saved, and its failure cannot reach the tap.
    func arm(for running: RunningShift?) {
        let plan = ShiftSignal.plan(for: running, now: .now)
        self.running = running

        if running != nil && !hasClockedIn {
            hasClockedIn = true
            UserDefaults.standard.set(true, forKey: Keys.hasClockedIn)
        }

        let center = UNUserNotificationCenter.current()

        // The badge is the "something on the home screen" the owner asked for. It is the
        // weakest signal in information terms - a dot with a number, no words - and the
        // most durable: SpringBoard owns it, so it survives a force-quit and a reboot
        // with the app never launched.
        //
        // AN OPEN SHIFT OWNS THE APP-ICON BADGE. Materials must never write it; the
        // materials count lives on the TAB badge, which is a different surface.
        Task { try? await center.setBadgeCount(plan.badgeCount) }

        // Cancel first, always. A shift that closed at 07:40 must not ping at 08:00.
        center.removePendingNotificationRequests(withIdentifiers: Self.allReminderIds)
        // AND take back the ones already DELIVERED. Removing only the pending ones leaves
        // the 07:00 "Still clocked in" banner sitting in Notification Center after a 07:40
        // tap-out, which is worse than no signal: it tells a worker who has finished that
        // they have not. Android cancels its delivered reminder by id for the same reason
        // (notify/ShiftSignals.arm -> manager.cancel(REMINDER_ID)); this is iOS matching it.
        center.removeDeliveredNotifications(withIdentifiers: Self.allReminderIds)
        if plan.remindersScheduled, let running {
            scheduleLadder(for: running, center: center)
        }

        if plan.liveActivity, let running {
            LiveActivityController.start(running)
        } else {
            LiveActivityController.end()
        }
    }

    // MARK: - The ladder

    /// One-shot requests at +1h .. +8h, each with its own wording, the last one being the
    /// auto-close itself. Rungs already in the past are skipped - re-arming after a
    /// reinstall four hours into a shift schedules 5h, 6h, 7h and 8h and nothing else.
    private func scheduleLadder(for running: RunningShift, center: UNUserNotificationCenter) {
        let now = Date.now
        for hour in ShiftSignal.reminderHours {
            let fireAt = running.startTime.addingTimeInterval(TimeInterval(hour) * 3600)
            let delay = fireAt.timeIntervalSince(now)
            guard delay > 0 else { continue }

            let content = UNMutableNotificationContent()
            if ShiftSignal.isAutoCloseWarning(hour: hour) {
                content.title = String(localized: "Shift closed automatically")
                content.body = String(
                    localized: "Your shift at \(running.locationName) hit 8 hours and was closed automatically. Open the app and confirm when you actually finished, or it will not be paid."
                )
            } else {
                content.title = String(localized: "Still clocked in")
                content.body = String(
                    localized: "\(hour) h at \(running.locationName). Hold your phone to the tag to finish."
                )
            }
            // .timeSensitive breaks through Focus and Scheduled Summary, but only once
            // the owner adds the Time Sensitive Notifications capability in Xcode
            // (docs/LIVE-ACTIVITY-SETUP.md). WITHOUT it the system silently degrades this
            // to .active, which is what we would have asked for anyway - so setting it is
            // free and the app ships correct in both states. .critical is deliberately
            // NOT used: it needs an Apple entitlement granted only for medical, safety
            // and security, and a timesheet is none of those.
            content.interruptionLevel = .timeSensitive
            content.sound = .default

            let request = UNNotificationRequest(
                identifier: Self.reminderId(hour: hour),
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
            )
            center.add(request) { _ in }   // a rejection changes nothing that matters
        }
    }

    // MARK: - Permission

    /// Ask once, AFTER the first clock-in, from the shift screen. Never on launch, never
    /// on the tap path (ShiftSignal.shouldAskForNotifications is the gate and it is
    /// check-covered).
    func requestAuthorizationIfNeeded() async {
        await refreshAuthorization()
        guard authorization == .notDetermined,
              ShiftSignal.shouldAskForNotifications(hasClockedIn: hasClockedIn,
                                                    alreadyAsked: alreadyAsked)
        else { return }

        alreadyAsked = true
        UserDefaults.standard.set(true, forKey: Keys.askedForNotifications)
        // .badge as well as .alert: without it the home-screen number never appears, and
        // the badge is the signal that survives everything else.
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])
        await refreshAuthorization()
        // Whatever the answer, re-state the world: a grant that lands mid-shift should
        // arm the ladder it just became allowed to schedule.
        arm(for: running)
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings()
            .authorizationStatus
    }

    /// True when the OS will show nothing outside the app. The shift screen says so in
    /// ONE sentence with a link to Settings - never a modal, never a nag, and never
    /// before a clock-in.
    var outOfAppSignalsSilenced: Bool {
        authorization == .denied
    }
}
