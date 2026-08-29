//
//  TapScanner.swift
//  NFCTimeSheets
//
//  THE FOREGROUND SCAN. The worker holds the phone to the tag while the app is ALREADY
//  OPEN and frontmost, presses "Scan a tag", and the system NFC sheet reads the card in
//  place - no background universal link, no app-switch, no "why did something just open,
//  I was already here" moment. That system-level transition is the whole reason this
//  exists; it is not a replacement for the background tap, which stays the normal path.
//
//  IT DOES NOT DECIDE ANYTHING. It resolves a location UUID exactly the way a universal
//  link does - the same NdefTag URI decode, the same TagLink.locationId(from:) trust
//  boundary - and hands it to `TapInbox.accept`, which is the SAME mailbox onOpenURL and
//  onContinueUserActivity post into. So clock-in/clock-out logic lives in exactly one
//  place (LogView.handleTap) and cannot drift; TapInbox's 3s collapse also means a
//  foreground scan and a background tap for one physical card is still one toggle.
//
//  NO ENTITLEMENT CHANGE. `com.apple.developer.nfc.readersession.formats = ["TAG"]` -
//  already the only permitted value (checks/entitlement-format-check.swift) - covers this
//  read. NDEF is App Store error 90778 and never comes back. Polling options are copied
//  from TagReaderProbe/TagWriter verbatim: [.iso14443, .iso15693], NEVER .iso18092, which
//  is the entitlement conflict that was already fixed once.
//
//  ponytail CEILING: this is a near-copy of TagReaderProbe.swift's session plumbing, kept
//  separate ON PURPOSE rather than factored out. TagReaderProbe's header promises,
//  structurally, that it can never open a shift ("never imports TapInbox, never touches
//  Sync"); sharing a base class would make that promise unreadable. Two ~80-line delegates
//  with one honest comment each beat one clever one. If a THIRD reader ever appears, that
//  is the moment to extract a shared session runner.
//

import CoreNFC
import Foundation

@MainActor
final class TapScanner: NSObject, NFCTagReaderSessionDelegate {

    enum Outcome {
        /// A real tag link resolved to this location UUID. Ready for TapInbox.
        case resolved(locationId: String)
        /// Read fine, but it is not one of ours (blank card, someone else's tag, a URL
        /// under a host TagLink refuses - decision-53).
        case unrecognised
        /// No session was started, or the transport failed. `message` is already localized
        /// and is shown as-is; nil means the worker cancelled and nothing should be said.
        case failed(message: String?)
    }

    private var continuation: CheckedContinuation<Outcome, Never>?
    private var session: NFCTagReaderSession?
    private var finished = false

    func scan() async -> Outcome {
        guard NFCTagReaderSession.readingAvailable else {
            return .failed(message: String(localized: "This iPhone can't read NFC tags."))
        }
        finished = false
        return await withCheckedContinuation { (cont: CheckedContinuation<Outcome, Never>) in
            self.continuation = cont
            guard let session = NFCTagReaderSession(
                // .iso18092 (FeliCa) dropped - see TagWriter.swift's comment on this same line.
                pollingOption: [.iso14443, .iso15693], delegate: self, queue: nil
            ) else {
                self.continuation = nil
                cont.resume(returning: .failed(message: String(localized: "This iPhone can't read NFC tags.")))
                return
            }
            session.alertMessage = String(localized: "Hold the tag near the top of the phone.")
            self.session = session
            session.begin()
        }
    }

    // MARK: - NFCTagReaderSessionDelegate

    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        Task { @MainActor in self.finish(self.outcome(forInvalidation: error)) }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard tags.count == 1, let tag = tags.first else {
            session.restartPolling()
            return
        }
        Task { @MainActor in await self.process(tag: tag, session: session) }
    }

    private func process(tag: NFCTag, session: NFCTagReaderSession) async {
        do {
            try await session.connect(to: tag)
        } catch {
            session.invalidate(errorMessage: String(localized: "Couldn't read this tag. Try again."))
            finish(.failed(message: String(localized: "Couldn't read this tag. Try again.")))
            return
        }

        var locationId: String?
        if let ndefTag = Self.ndefTag(from: tag) {
            do {
                let message = try await ndefTag.readNDEF()
                let uri = NdefTag.uriFrom(records: Self.decode(message))
                locationId = uri.flatMap(URL.init(string:)).flatMap(TagLink.locationId(from:))
            } catch let error as NSError
                where error.domain == NFCErrorDomain
                    && error.code == NFCReaderError.ndefReaderSessionErrorZeroLengthMessage.rawValue {
                locationId = nil    // a blank card is "not one of ours", not a failure
            } catch {
                session.invalidate(errorMessage: String(localized: "Couldn't read this tag. Try again."))
                finish(.failed(message: String(localized: "Couldn't read this tag. Try again.")))
                return
            }
        }

        session.invalidate()
        // No hardware-serial fallback here, unlike TagReaderProbe: a worker's phone has no
        // zone worklist to match a serial against, and inventing a compiled table of them
        // is exactly what decision-44 deleted.
        if let locationId {
            finish(.resolved(locationId: locationId))
        } else {
            finish(.unrecognised)
        }
    }

    // MARK: - CoreNFC shapes

    private static func ndefTag(from tag: NFCTag) -> (any NFCNDEFTag)? {
        switch tag {
        case .feliCa(let t): return t
        case .iso7816(let t): return t
        case .iso15693(let t): return t
        case .miFare(let t): return t
        @unknown default: return nil
        }
    }

    private static func decode(_ message: NFCNDEFMessage?) -> [NdefTag.DecodedRecord]? {
        guard let message else { return nil }
        return message.records.map {
            NdefTag.DecodedRecord(
                typeNameFormatRaw: $0.typeNameFormat.rawValue,
                type: Array($0.type),
                identifier: Array($0.identifier),
                payload: Array($0.payload)
            )
        }
    }

    private func outcome(forInvalidation error: Error) -> Outcome {
        let nsError = error as NSError
        guard nsError.domain == NFCErrorDomain, let code = NFCReaderError.Code(rawValue: nsError.code) else {
            return .failed(message: nsError.localizedDescription)
        }
        switch code {
        case .readerErrorSecurityViolation:
            // Same wording TagReaderProbe uses: the capability is the owner's one click
            // (decision-49) and the app degrades in words, never in a crash.
            return .failed(message: String(localized:
                "Tag writing isn't switched on in this build. Ask the developer to enable the NFC Tag Reading capability in Xcode - see docs/NFC-WRITE-SETUP.md."))
        case .readerSessionInvalidationErrorUserCanceled:
            return .failed(message: nil)        // they closed the sheet; say nothing
        case .readerSessionInvalidationErrorFirstNDEFTagRead,
             .readerSessionInvalidationErrorSessionTerminatedUnexpectedly:
            return .failed(message: nil)
        default:
            return .failed(message: nsError.localizedDescription)
        }
    }

    private func finish(_ outcome: Outcome) {
        guard !finished else { return }
        finished = true
        continuation?.resume(returning: outcome)
        continuation = nil
        session = nil
    }
}
