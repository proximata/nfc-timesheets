//
//  BuildingPicker.swift
//  NFCTimeSheets
//
//  ONE building picker, two screens (decision-54 §2 and §3). WriteTagScreen asks the
//  building question right after a card is reported; VerifyZoneScreen asks the SAME question
//  of a zone that was created without an answer. Two copies of a Picker is how the two
//  screens quietly drift into offering different lists, different labels and a different
//  idea of what "no building" means - which is the whole shape decision-54 §5 deleted from
//  the code-entry forms and is not worth re-growing here.
//
//  THE DIFFERENCE THAT IS REAL is `allowsSkip`, and it is not cosmetic: at WRITE time an
//  unbound zone is a legitimate resting state ("card up, building not decided yet"), so
//  no-building is an ANSWER. At BIND time it is not an answer at all - binding to nothing is
//  what the zone already is - so the empty row is a prompt, not an option, and the caller
//  keeps its submit button disabled while it is selected.
//
//  ponytail: a customer with hundreds of buildings would want a searchable list here. At
//  this size the stock Picker is free and does the job.
//

import SwiftUI

struct BuildingPicker: View {
    let locations: [WireOperatorLocation]
    let allowsSkip: Bool
    @Binding var selection: String?

    var body: some View {
        Picker("Building", selection: $selection) {
            // Always present, always first: a Picker whose selection is nil with no matching
            // tag renders BLANK, which reads as a broken control rather than as a question
            // nobody has answered yet.
            Text(allowsSkip
                 ? String(localized: "Skip for now")
                 : String(localized: "Choose a building"))
                .tag(String?.none)
            ForEach(locations) { location in
                Text(location.name).tag(String?.some(location.id))
            }
        }
    }
}
