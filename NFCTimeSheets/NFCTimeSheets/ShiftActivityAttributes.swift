//
//  ShiftActivityAttributes.swift
//  NFCTimeSheets
//
//  THE ONE TYPE THE APP AND THE WIDGET EXTENSION BOTH NEED, in its own file so it can be
//  given two target memberships with one tick in the File Inspector. That is step 8 of
//  docs/LIVE-ACTIVITY-SETUP.md and it is the owner's click, not an agent's - a new target
//  means editing project.pbxproj.
//
//  Until that target exists this compiles into the app alone and does nothing, which is
//  exactly the intended inert state.
//

import ActivityKit
import Foundation

/// Shared with the widget extension once it exists. The owner moves this type into the
/// extension's target membership as step 8 of docs/LIVE-ACTIVITY-SETUP.md; until then it
/// is compiled into the app alone, which is harmless.
///
/// `startTime` and `locationName` are static for the life of the activity, so they are
/// attributes rather than state. The elapsed time is NOT carried in ContentState: the
/// widget draws it with Text(timerInterval:), which the system ticks. Pushing a new
/// state every second would be absurd and is not how ActivityKit works.
struct ShiftActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Past the 8h boundary: the widget stops showing a running clock and says the
        /// shift must be confirmed. State in words, never colour alone.
        public var overdue: Bool

        public init(overdue: Bool) { self.overdue = overdue }
    }

    public var locationName: String
    public var startTime: Date

    public init(locationName: String, startTime: Date) {
        self.locationName = locationName
        self.startTime = startTime
    }
}
