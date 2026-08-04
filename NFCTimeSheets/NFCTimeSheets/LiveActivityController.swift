//
//  LiveActivityController.swift
//  NFCTimeSheets
//
//  The strongest out-of-app signal iOS has: a Live Activity on the Lock Screen and in the
//  Dynamic Island, with a timer the SYSTEM ticks - no background execution, no battery,
//  no network, and it survives a force-quit because the widget extension renders it, not
//  this process.
//
//  IT IS INERT UNTIL THE OWNER ADDS THE WIDGET EXTENSION TARGET.
//
//  Apple: "Create a widget extension ... The code that describes the user interface of
//  your Live Activity is part of your app's widget extension." A new target means editing
//  NFCTimeSheets.xcodeproj/project.pbxproj, which agents must never touch. So this file
//  ships complete and does nothing: with no extension, Activity.request throws, `try?`
//  eats it, and the app behaves exactly as it does today. The moment the owner follows
//  docs/LIVE-ACTIVITY-SETUP.md the same code starts working with no further change.
//
//  WHAT IT DOES NOT NEED: no new capability, no entitlement, no server, no push. The
//  Info.plist key NSSupportsLiveActivities is in NFCTimeSheets/Info.plist, which is
//  already wired through INFOPLIST_FILE - that key needed no project edit either.
//
//  HARD 8-HOUR CEILING, and it is a feature. Apple ends a Live Activity after eight
//  hours; that is exactly when nfc-autoclose.timer closes the shift (decision-10). So the
//  Live Activity can never outlive the shift it describes. Never promise a worker "it
//  stays there until you tap out" - promise "it is there while the shift is".
//
//  iOS 18.0 SURFACE ONLY. Activity.request(attributes:content:pushType:) and nothing
//  else: the style:, startDate: and alertConfiguration: overloads and
//  ActivityStyle.transient are all newer than the deployment target.
//
//  The shared attributes type lives in ShiftActivityAttributes.swift, in its own file so
//  the owner can hand it a second target membership with one tick.
//

import ActivityKit
import Foundation

@MainActor
enum LiveActivityController {

    /// Start (or re-point) the Live Activity for the running shift.
    ///
    /// Apple: "you can only start a Live Activity while the app is in the foreground."
    /// A tag tap opens the universal link, which foregrounds the app, so the tap path is
    /// a legal place to call this. There is no App Intents / LiveActivityIntent path here
    /// and none is needed.
    ///
    /// Every exit is silent. Live Activities disabled for this app in Settings, no widget
    /// extension, the system refusing for its own reasons - all of them are "no signal",
    /// none of them is an error the worker should see.
    static func start(_ running: RunningShift) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let content = ActivityContent(
            state: ShiftActivityAttributes.ContentState(overdue: running.serverAutoClosed),
            // The system dims the activity as stale at the auto-close boundary even if
            // nothing updates it - which is the honest thing for it to do, because at
            // that moment the server has closed the shift.
            staleDate: ShiftSignal.autoCloseDeadline(after: running.startTime)
        )

        // Already showing this exact shift: update rather than stack a second one.
        if let existing = Activity<ShiftActivityAttributes>.activities.first(where: {
            $0.attributes.startTime == running.startTime
        }) {
            Task { await existing.update(content) }
            return
        }

        end()   // a different shift's activity must not linger next to the new one

        _ = try? Activity.request(
            attributes: ShiftActivityAttributes(locationName: running.locationName,
                                                startTime: running.startTime),
            content: content,
            pushType: nil       // there is no APNs in this system (decision-23)
        )
    }

    /// Tear every one of ours down. `.immediate`, not a dismissal policy with a grace
    /// period: a shift that has ended must not sit on the Lock Screen implying it has not.
    static func end() {
        for activity in Activity<ShiftActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
