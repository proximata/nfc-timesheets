//
//  WriteTagStep.swift
//  NFCTimeSheets
//
//  THE ONE STEP WriteTagScreen IS ON, derived rather than remembered. Foundation-only and
//  free of SwiftUI on purpose, so checks/write-tag-step-check.swift can walk a whole
//  two-card session on a laptop - a simulator has no radio and the bug this file exists to
//  kill only shows up on the SECOND card of one session.
//
//  WHAT WENT WRONG WITHOUT IT: the screen rendered its mint plan, its write result and its
//  report error as three INDEPENDENT sections, each with its own condition. Nothing said
//  they were alternatives, so a second card in the same session stacked all three on screen
//  at once - the plan for the next card, the result of this one, and a report failure left
//  over from the previous one. One derived step means "exactly one panel" is a property of
//  the type instead of a property of whoever last edited the view body.
//

import Foundation

enum WriteTagStep: Equatable {
    /// Nothing written yet in this attempt: the mint plan and the Write button.
    case plan
    /// Exactly one write outcome, plus the report line and its retry underneath it.
    case result
    /// The office knows the id. Name the door.
    case zone

    /// The screen's whole rendering decision, from the three facts it holds.
    ///
    /// Order matters and is the fix: the zone step OUTRANKS a stale outcome, and an
    /// outcome outranks the plan. `reset` on a new attempt is what makes those facts
    /// describe the CURRENT card rather than the previous one.
    static func current(hasOutcome: Bool, reportSent: Bool, hasReportedId: Bool) -> WriteTagStep {
        if reportSent && hasReportedId { return .zone }
        return hasOutcome ? .result : .plan
    }
}
