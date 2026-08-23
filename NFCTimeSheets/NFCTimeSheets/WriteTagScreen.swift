//
//  WriteTagScreen.swift
//  NFCTimeSheets
//
//  Reachable only once an operator is signed in (OperatorSignInScreen.swift). Mirrors
//  android/.../nfc/WriteTagActivity.kt's shape: mint an id, present the system NFC sheet,
//  show exactly one Outcome, then report it - and the report is SOFT, never downgrading a
//  verified write (decision-49). NOTHING here opens or closes a shift: OperatorTagAPI
//  carries the ts_operator cookie, which no shift route accepts (decision-45).
//

import SwiftUI

struct WriteTagScreen: View {
    @State private var pendingId = UUID().uuidString.lowercased()
    @State private var writer = TagWriter()
    @State private var outcome: TagWriter.Outcome?
    @State private var confirmedFor: String?
    @State private var confirmText = ""
    @State private var busy = false
    @State private var report: ReportState = .idle

    private enum ReportState: Equatable {
        case idle, sending, sent
        case failed
    }

    var body: some View {
        Form {
            Section {
                Text("This never opens a shift. A fresh id is minted on this phone before anything is written.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                LabeledContent("Card id", value: pendingId)
                    .font(.system(.footnote, design: .monospaced))
            }

            Section {
                Text(statusText)
                    .accessibilityLabel(statusText)
                if let occupied = occupiedOutcome, confirmedFor != occupied.onTag {
                    TextField("Last six characters", text: $confirmText)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Button("Overwrite") {
                        confirmedFor = occupied.onTag
                        confirmText = ""
                    }
                    .disabled(!WriteGuard.confirms(locationId: occupied.onTag, typed: confirmText))
                }
                Button("Write") { Task { await write() } }
                    .disabled(busy)
            }

            if case .written(let locationId, _, _, _, _) = outcome, report != .sent {
                Section {
                    Text(reportText)
                        .font(.footnote)
                    Button("Tell the office") { Task { await sendReport(locationId) } }
                        .disabled(busy)
                }
            }
        }
        .navigationTitle("Write a tag")
    }

    private var occupiedOutcome: (onTag: String, offered: String, token: String)? {
        guard case .refusedOccupied(let onTag, let offered, let token) = outcome else { return nil }
        return (onTag, offered, token)
    }

    private func write() async {
        busy = true
        defer { busy = false }
        let result = await writer.write(locationId: pendingId, confirmedOverwriteOf: confirmedFor)
        outcome = result
        if case .written = result {
            // The confirmation is SPENT: it authorised one card, and the next card
            // presented starts from refused again.
            confirmedFor = nil
            confirmText = ""
            if case .written(let locationId, _, _, _, _) = result {
                await sendReport(locationId)
            }
        }
    }

    private func sendReport(_ locationId: String) async {
        guard !busy || report != .sending else { return }
        report = .sending
        do {
            _ = try await OperatorTagAPI.reportTag(id: locationId)
            report = .sent
            // The id has now left this phone, so the NEXT card must not reuse it.
            pendingId = UUID().uuidString.lowercased()
        } catch {
            report = .failed
        }
    }

    private var reportText: String {
        switch report {
        case .idle: return ""
        case .sending: return String(localized: "Telling the office…")
        case .sent: return String(localized: "Reported.")
        case .failed: return String(localized: "Couldn't reach the office yet - the card is fine. Retry.")
        }
    }

    private var statusText: String {
        guard let outcome else {
            return busy ? String(localized: "Hold your phone near the card.") : ""
        }
        switch outcome {
        case .written(let locationId, _, let bytes, let capacity, let replaced):
            let base = String(localized: "Written: \(locationId) — \(bytes) of \(capacity) bytes.")
            switch replaced {
            case .blank:
                return base
            case .foreign(let summary):
                return base + " " + String(localized: "This card held something else before: \(summary).")
            case .ours(let onTag):
                return base + " " + String(localized: "This card held one of our own ids before: \(onTag).")
            }
        case .refusedTooSmall(let needed, let capacity):
            return String(localized: "Too small for this tag: needs \(needed) bytes, this tag holds \(capacity).")
        case .refusedReadOnly:
            return String(localized: "This tag is locked read-only.")
        case .refusedNoCapacity:
            return String(localized: "This tag reports no writable space.")
        case .refusedNotFormatted:
            return String(localized: "This tag isn't NDEF-formatted.")
        case .refusedBadId:
            return String(localized: "Couldn't build a tag for this id.")
        case .refusedOccupied(let onTag, _, let token):
            if confirmedFor == onTag {
                return String(localized: "Present the card again to overwrite \(onTag).")
            }
            return String(localized: "This card already belongs to \(onTag). Type the last six characters to overwrite it: \(token).")
        case .unverified(let reason):
            return String(localized: "The write didn't verify (\(reason)). Present this card again.")
        case .lost(let reason):
            return String(localized: "Lost the connection (\(reason)). Try again.")
        case .unavailable(let message):
            return message
        }
    }
}
