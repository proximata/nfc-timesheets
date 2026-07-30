//
//  MigrationReceiptView.swift
//  NFCTimeSheets
//
//  What the worker sees after an on-device migration touched their rows.
//
//  These are somebody's timesheets. Rows may not simply be fewer than they were the day
//  before: the sheet below says what happened, once, and Settings > Migration history
//  keeps saying it afterwards for anyone who dismissed it at a door at 06:00.
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
                         : "We cleaned up \(cleared.count) old record\(cleared.count == 1 ? "" : "s")")
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
                        Text("\(needsAdmin.count) old shift\(needsAdmin.count == 1 ? "" : "s") need your admin")
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

/// The same list, permanently, read back from the archive file rather than from memory.
struct MigrationHistoryView: View {
    @State private var shifts: [ArchivedShift] = []

    var body: some View {
        List {
            if shifts.isEmpty {
                Text("Nothing has been archived on this phone.").foregroundStyle(.secondary)
            }
            ForEach(shifts) { MigrationRow(shift: $0) }
        }
        .navigationTitle("Migration history")
        .task { shifts = MigrationReceipt.archived() }
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
