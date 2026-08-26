//
//  MigrationReceiptView.swift
//  NFCTimeSheets
//
//  What the worker sees after an on-device migration touched their rows.
//
//  These are somebody's timesheets. Rows may not simply be fewer than they were the day
//  before: the sheet below says what happened, once, at the moment it happens - that used
//  to be backed up by a permanent Settings > Migration history entry, removed on request
//  (it read as one more confusing screen to a worker, not as reassurance) once every archived
//  row it could show was already surfaced by the one-time sheet or by a synced/blocked
//  banner. MigrationReceipt.archived() (MigrationCore.swift) is untouched: the file on disk
//  is still the audit trail decision-8's "nothing discarded without export first" needs -
//  only the in-app second reading of it is gone.
//
//  ponytail: hardcoded English literals, matching the rest of this app.
//  CEILING: decision-8 wants every user-visible string externalised; 3A does that work on
//  the web admin only. UPGRADE PATH: move the whole app to Localizable.xcstrings in one
//  pass rather than half of it now.
//

import SwiftUI

struct MigrationReceiptSheet: View {
    @Environment(\.dismiss) private var dismiss
    let shifts: [ArchivedShift]

    private var cleared: [ArchivedShift] { shifts.filter { $0.disposition == "cleared" } }
    private var needsAdmin: [ArchivedShift] { shifts.filter { $0.disposition != "cleared" } }

    var body: some View {
        NavigationStack {
            // ScrollView, not a fixed stack: at the largest accessibility text sizes this
            // list is taller than the screen, and a worker who cannot read WHY their rows
            // changed is exactly the person this screen exists for.
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(cleared.isEmpty
                         ? "We checked your old records"
                         // ponytail: was a Swift-side 's' suffix smuggled across the
                         // language boundary via %@ (TASK-40) - German doesn't pluralise by
                         // adding s, so "Eintrags" isn't a word. A plain %lld interpolation
                         // lets Localizable.xcstrings carry a real one/other plural variation
                         // per language instead, where noun AND verb can both agree.
                         : "We cleaned up \(cleared.count) old records")
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)

                    if !cleared.isEmpty {
                        Text("These came from an older version of the app. They had no building and no hours, so they could not be sent and could not be paid. A copy is kept on this phone.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                        ForEach(cleared) { MigrationRow(shift: $0) }
                    }

                    if !needsAdmin.isEmpty {
                        Divider()
                        Text("\(needsAdmin.count) old shifts need your admin")  // ponytail: see TASK-40 comment above - plural variation lives in the catalog, not a Swift suffix
                            .font(.headline)
                            .foregroundStyle(.orange)
                            .accessibilityAddTraits(.isHeader)
                        Text("These have hours but no building, so nobody can send them without knowing where they were worked. Your admin has to enter them - they have not been lost.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                        ForEach(needsAdmin) { MigrationRow(shift: $0) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .navigationTitle("App update")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

private struct MigrationRow: View {
    let shift: ArchivedShift

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(shift.startTime.formatted(date: .abbreviated, time: .shortened))
                    .font(.subheadline)
                Spacer()
                Text(shift.duration.map(fmtDur) ?? "not finished")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(shift.disposition)
                .font(.caption2)
                .foregroundStyle(shift.disposition == "cleared" ? Color.secondary : Color.orange)
        }
        .padding(.vertical, 2)
        // One VoiceOver item per record: three fragments read separately are noise.
        .accessibilityElement(children: .combine)
    }
}

private extension ArchivedShift {
    var duration: TimeInterval? { endTime.map { $0.timeIntervalSince(startTime) } }
}
