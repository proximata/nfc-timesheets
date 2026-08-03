//
//  MaterialsView.swift
//  NFCTimeSheets
//
//  "I need something." The worker writes it in their own words, sees where it got to,
//  and is told when it is in the warehouse.
//
//  THIS SCREEN IS NOT THE PRODUCT. Clocking in is. Nothing here is on the tap path,
//  nothing here is awaited by LogView, and every failure below ends as a sentence on a
//  row rather than as a blocked screen.
//
//  ponytail: English literals, matching the rest of this app (see APIFailure.workerMessage
//  for the same note). CEILING: decision-8 wants every user-visible string externalised
//  and German by default, which the Android client already is. UPGRADE PATH: move the
//  WHOLE app to a String Catalog in one pass - half a German app is worse than an
//  English one.
//

import SwiftData
import SwiftUI

struct MaterialsView: View {
    @Environment(MaterialStore.self) private var store
    let worker: WireWorker

    /// Read-only, from the app's existing container. Used for two cosmetic things: which
    /// building to attach as CONTEXT, and what to call it. Nothing branches on either -
    /// a request with no building is a perfectly good request.
    @Query(sort: \Shift.startTime, order: .reverse) private var shifts: [Shift]
    @Query private var sites: [Site]

    @State private var typed = ""
    @FocusState private var writing: Bool

    private var openShift: Shift? { shifts.first(where: \.isOpen) }
    private var contextLocationId: String? { openShift?.locationId }
    private func siteName(_ id: String) -> String? { sites.first { $0.locationId == id }?.name }

    private var canSubmit: Bool { MaterialQueue.normalise(typed) != nil }

    var body: some View {
        NavigationStack {
            List {
                arrivals
                compose
                history
            }
            .navigationTitle("Materials")
            .refreshable { await store.sync(workerId: worker.id) }
            // ContentView.start() already ran at launch and read the file; this is the
            // poll on opening the tab. It is a no-op until the file has been read - see
            // MaterialStore.started, which exists so this cannot flush an empty cache
            // over a queued request.
            .task(id: worker.id) { await store.sync(workerId: worker.id) }
        }
    }

    // MARK: - Arrived, and nobody has been told

    /// The whole reason this screen polls. `arrived` + no `seen_at`.
    @ViewBuilder private var arrivals: some View {
        if !store.unseenArrivals.isEmpty {
            Section("Ready to collect") {
                ForEach(store.unseenArrivals) { request in
                    VStack(alignment: .leading, spacing: 8) {
                        Label("At the warehouse", systemImage: "tray.and.arrow.down.fill")
                            .font(.headline)
                            .foregroundStyle(.green)
                        Text(request.itemName ?? request.body)
                            .font(.body)
                        if let arrived = request.arrivedAt {
                            Text("Arrived \(arrived.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Button("Got it") {
                            Task { await store.markSeen(request) }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityHint("Removes this from the ready-to-collect list")
                    }
                    .padding(.vertical, 4)
                    // One item to VoiceOver, with the state said out loud rather than
                    // only shown in green. The button stays separately focusable.
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Ready to collect: \(request.itemName ?? request.body)")
                }
            }
        }
    }

    // MARK: - Ask

    @ViewBuilder private var compose: some View {
        Section {
            TextField("What do you need?", text: $typed, axis: .vertical)
                .lineLimit(3...8)
                .focused($writing)
                .accessibilityLabel("What do you need?")
                .accessibilityHint("Write it in your own words, for example: two mops and a large bottle of glass cleaner")
                .onChange(of: typed) { _, new in
                    // Hard stop at the server's own limit rather than a 400 the worker
                    // cannot read. Truncating only when it is exceeded means the cursor
                    // is never moved under someone who is still typing.
                    if new.count > MaterialAPI.bodyMaxLength {
                        typed = String(new.prefix(MaterialAPI.bodyMaxLength))
                    }
                }

            if typed.count > MaterialAPI.bodyMaxLength - 200 {
                Text("\(typed.count) of \(MaterialAPI.bodyMaxLength) characters")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let id = contextLocationId {
                Label(siteName(id).map { "For \($0)" } ?? "For the building you're in now",
                      systemImage: "building.2")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button("Send request") {
                // Only clear the field if the row was actually accepted. Clearing first
                // and asking later is how a worker's typing disappears into nothing.
                guard store.submit(body: typed, locationId: contextLocationId, workerId: worker.id) else { return }
                typed = ""
                writing = false
                AccessibilityNotification.Announcement("Request saved. It will be sent as soon as you're online.").post()
            }
            .disabled(!canSubmit)
        } header: {
            Text("Ask for something")
        } footer: {
            // decision-23: the server's dependencies are pg + @sentry/node. There is no
            // APNs certificate and no device-token table, so there is NO PUSH. This app
            // POLLS. Promising a notification to somebody who then does not get one is
            // the difference between a late delivery and a broken product.
            Text(openShift == nil
                 ? "The office reads these on the web. Open this tab to see when something arrives - your phone will not notify you."
                 : "Sent with the building you're clocked into now, so the office knows where you are. Open this tab to see when something arrives - your phone will not notify you.")
        }
    }

    // MARK: - Everything, newest first

    @ViewBuilder private var history: some View {
        Section("Your requests") {
            if store.featureUnavailable {
                Label("The office hasn't switched this on yet. Anything you write is saved and sent as soon as they do.",
                      systemImage: "clock.badge.questionmark")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if store.cacheWasCorrupt {
                Label("Some older requests on this phone couldn't be read. Anything already sent is safe on the server.",
                      systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            if store.entries.isEmpty {
                Text("Nothing asked for yet.").foregroundStyle(.secondary)
            }
            ForEach(store.entries) { entry in
                switch entry {
                case .queued(let row): QueuedMaterialRow(row: row, siteName: siteName)
                case .sent(let row): SentMaterialRow(row: row)
                }
            }
        }
    }
}

// MARK: - Rows

/// Written, not yet acknowledged by the server. Never silently pretty: an unsent request
/// says it is unsent, and a rejected one says a human has to act.
private struct QueuedMaterialRow: View {
    let row: QueuedMaterialRequest
    let siteName: (String) -> String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.body).font(.body)
            if let id = row.locationId, let name = siteName(id) {
                Text(name).font(.caption).foregroundStyle(.secondary)
            }
            Text(row.createdAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption).foregroundStyle(.secondary)
            if let error = row.errorMessage {
                Label(error, systemImage: row.blocked ? "xmark.octagon.fill" : "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90")
                    .font(.caption2)
                    .foregroundStyle(row.blocked ? .red : .orange)
            } else {
                Label("Sending…", systemImage: "arrow.up.circle")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// The server's copy. `status` is the only thing that says where it got to, and it is
/// always rendered as WORDS - the colour is a second signal, never the only one.
private struct SentMaterialRow: View {
    let row: WireMaterialRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.body).font(.body)
            if let item = row.itemName {
                Text(row.quantity.map { "\($0) × \(item)" } ?? item)
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let location = row.locationName {
                Text(location).font(.caption).foregroundStyle(.secondary)
            }
            Label(Self.statusText(row), systemImage: Self.statusIcon(row))
                .font(.caption)
                .foregroundStyle(Self.statusColour(row))
            if let note = row.adminNote, !note.isEmpty {
                // The office's own words about this decision. It is the only explanation
                // a refused worker gets, so it is shown rather than swallowed.
                Text("Note from the office: \(note)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(row.createdAt.formatted(date: .abbreviated, time: .shortened))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// An unknown status is reported as unknown. Inventing "in progress" for a value this
    /// build has never seen would be a guess shown as a fact.
    static func statusText(_ row: WireMaterialRequest) -> String {
        switch row.status {
        case .submitted: return "Waiting for the office"
        case .approved: return "Approved - not ordered yet"
        case .ordered: return "Ordered"
        case .arrived: return row.seenAt == nil ? "At the warehouse" : "Collected"
        case .rejected: return "Not approved"
        case nil: return "Status unknown - ask your admin"
        }
    }

    static func statusIcon(_ row: WireMaterialRequest) -> String {
        switch row.status {
        case .submitted: return "paperplane"
        case .approved: return "checkmark.circle"
        case .ordered: return "shippingbox"
        case .arrived: return "tray.and.arrow.down.fill"
        case .rejected: return "xmark.circle"
        case nil: return "questionmark.circle"
        }
    }

    static func statusColour(_ row: WireMaterialRequest) -> Color {
        switch row.status {
        case .arrived: return row.seenAt == nil ? .green : .secondary
        case .rejected: return .red
        case .submitted, .approved, .ordered, nil: return .secondary
        }
    }
}
