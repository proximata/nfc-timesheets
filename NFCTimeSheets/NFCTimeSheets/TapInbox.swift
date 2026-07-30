//
//  TapInbox.swift
//  NFCTimeSheets
//
//  The hand-off between "iOS opened a universal link off a tag" and "the Log tab wrote
//  a row". Lifted out of NFCTimeSheetsApp.swift so it is Foundation + Observation only:
//  the cold-launch ordering below is the exact thing that lost the owner's first real
//  tap, and it is now pinned by checks/tap-inbox-check.swift outside Xcode.
//

import Foundation
import Observation

/// Where a tap arrives from, whichever way it came in: the in-app NDEF scan, or iOS
/// opening the universal link off the tag while the app was in the background.
///
/// Both paths can fire for a single physical tap, so identical taps inside a short
/// window collapse into one. Without this, one tap would clock in and straight back out.
///
/// COLD LAUNCH ORDERING - the reason this is a mailbox and not a callback.
/// `onOpenURL` fires in NFCTimeSheetsApp while `Session.restore()` is still running, so
/// on a tap-launch the tap arrives BEFORE LogView exists. Two orderings have to work and
/// both are covered by the consumer in LogView:
///
///   set-before-mount: accept() parks the id here while ContentView is still showing the
///     launch spinner. LogView mounts later and `.task` calls take() -> handled once.
///     `.onChange` does NOT fire for a value that was already set when the view appeared
///     (no `initial: true`), so it cannot handle the same tap a second time.
///   set-after-mount: LogView is already up, `.task` already took nil. accept() flips
///     pendingLocationId nil -> X, `.onChange` fires, take() returns X -> handled once.
///
/// In both orderings take() then flips X -> nil, which fires `.onChange` again with a
/// nil id; the consumer's `guard id != nil` drops that echo. So: never lost, never twice.
@Observable
final class TapInbox {
    var pendingLocationId: String?
    private var last: (locationId: String, at: Date)?
    private let window: TimeInterval = 3

    func accept(_ locationId: String) {
        if let last, last.locationId == locationId, Date.now.timeIntervalSince(last.at) < window { return }
        last = (locationId, .now)
        pendingLocationId = locationId
    }

    func take() -> String? {
        defer { pendingLocationId = nil }
        return pendingLocationId
    }
}
