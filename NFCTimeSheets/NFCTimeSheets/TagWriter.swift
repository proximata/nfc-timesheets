//
//  TagWriter.swift
//  NFCTimeSheets
//
//  THE ONE PLACE THIS APP MODIFIES A PHYSICAL OBJECT (decision-49). The ORDER below is a
//  faithful port of android/.../nfc/TagWriter.kt's header - not of its Android APIs, which
//  do not exist on this platform:
//
//    1. read the tag's own facts         - capacity, writability. NOTHING is written yet.
//    2. DECIDE, in pure code             - NdefTag.plan(), which checks/ run on a laptop
//    3. read WHAT THE CARD ALREADY SAYS  - and refuse a card that carries one of OUR ids
//       (TASK-220, WriteGuard.swift) - a LIVE re-read, never a cache: iOS has no cache
//       here to begin with, so there is nothing to accidentally reuse.
//    4. only then write                  - and only the exact bytes the decision carried
//    5. read the card back and COMPARE   - see NdefTag.swift's header for why this is a
//       RECONSTRUCTED byte compare and not a raw one: CoreNFC exposes no raw bytes for a
//       message it read or wrote, only `records` and `length`.
//
//  Step 2 is where the 46-byte tag is refused - the tag already mounted at HOIV holds 46
//  bytes, our message needs ~64. Step 3 is the only step that protects a card that is
//  ALREADY WORKING; steps 1, 2 and 5 all guard the card in the operator's hand, none of
//  them say anything about the card on the wall.
//
//  WHAT IS NEVER DONE HERE: `writeLock()`. Tags stay UNLOCKED (decision-15) - locking is
//  irreversible and the migration insurance is worth more than the non-protection locking
//  would buy.
//
//  ONE SESSION PER ATTEMPT, not Android's persistent reader mode. CoreNFC's foreground
//  session shows a system sheet and ends with exactly one outcome; WriteTagScreen calls
//  `write` again for a retry, which shows the sheet again - the ordinary shape of a CoreNFC
//  flow, not a workaround.
//
//  GRACEFUL DEGRADATION (decision-49). The capability
//  `com.apple.developer.nfc.readersession.formats` is deliberately NOT in this build's
//  entitlements yet (see NFCTimeSheets.entitlements and docs/NFC-WRITE-SETUP.md) - that is
//  the owner's one Xcode click, not something this code can add safely. Two runtime
//  signals, and there is no third: `NFCTagReaderSession.readingAvailable` before a session
//  is even attempted, and `NFCReaderError.readerErrorSecurityViolation` from
//  `didInvalidateWithError` if a session is attempted without the entitlement. Both map to
//  `.unavailable` below. Nothing crashes, nothing is written.
//

import CoreNFC
import Foundation

@MainActor
final class TagWriter: NSObject, NFCTagReaderSessionDelegate {

    enum Outcome {
        /// Written AND read back byte-identical. The ONLY outcome that may be reported to
        /// the server.
        case written(locationId: String, uri: String, bytes: Int, capacity: Int, replaced: WriteGuard.Existing)

        /// Refused BEFORE any write. The card is untouched.
        case refusedTooSmall(needed: Int, capacity: Int)
        case refusedReadOnly
        case refusedNoCapacity
        case refusedNotFormatted
        case refusedBadId

        /// THE CARD IS ALREADY ONE OF OURS (TASK-220), carrying a DIFFERENT id from the one
        /// being offered. `token` is what the operator must type to override it -
        /// see WriteGuard.swift.
        case refusedOccupied(onTag: String, offered: String, token: String)

        /// The write was ATTEMPTED and did not verify. THE CARD IS SUSPECT - it may hold a
        /// partial message. Re-present it (harmless, and fixes it) or discard it. Never
        /// reported to the server.
        case unverified(reason: String)

        /// The tag left the field, or the transport failed, at some point. Nothing claimed.
        case lost(reason: String)

        /// No session was started at all: this device cannot read NFC, or this build does
        /// not carry the capability yet. `message` is already localized and safe to show
        /// verbatim.
        case unavailable(message: String)
    }

    private var continuation: CheckedContinuation<Outcome, Never>?
    private var session: NFCTagReaderSession?
    private var locationId = ""
    private var confirmedOverwriteOf: String?
    private var finished = false

    /// Present the system NFC sheet, write `locationId` onto whatever tag is presented,
    /// and report exactly one Outcome.
    ///
    /// - Parameter confirmedOverwriteOf: the location id the OPERATOR has explicitly
    ///   confirmed destroying, typed back character by character on the screen. Nil on
    ///   every ordinary write. It authorises exactly that one id - presenting a DIFFERENT
    ///   mounted card is refused again, because `WriteGuard.decide` compares it against the
    ///   id read off the card in the field, never against "something was confirmed".
    func write(locationId: String, confirmedOverwriteOf: String?) async -> Outcome {
        guard NFCTagReaderSession.readingAvailable else {
            return .unavailable(message: String(localized: "This iPhone can't read NFC tags."))
        }
        self.locationId = locationId
        self.confirmedOverwriteOf = confirmedOverwriteOf
        finished = false
        return await withCheckedContinuation { (cont: CheckedContinuation<Outcome, Never>) in
            self.continuation = cont
            guard let session = NFCTagReaderSession(
                pollingOption: [.iso14443, .iso15693, .iso18092], delegate: self, queue: nil
            ) else {
                self.continuation = nil
                cont.resume(returning: .unavailable(message: String(localized: "This iPhone can't read NFC tags.")))
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

    // MARK: - the five steps

    private func process(tag: NFCTag, session: NFCTagReaderSession) async {
        do {
            try await session.connect(to: tag)
        } catch {
            finish(.lost(reason: "\(error)"))
            return
        }
        guard let ndefTag = Self.ndefTag(from: tag) else {
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedNotFormatted)
            return
        }

        // ---- 1. the tag's own facts, read before anything is decided -------------------
        let status: NFCNDEFStatus
        let capacity: Int
        do {
            let (rawStatus, rawCapacity) = try await ndefTag.queryNDEFStatus()
            status = rawStatus
            capacity = rawCapacity
        } catch {
            session.invalidate(errorMessage: String(localized: "Couldn't read this tag. Try again."))
            finish(.lost(reason: "\(error)"))
            return
        }

        // CoreNFC exposes no way to format a tag from this API (see NFCNDEFTag.h - there is
        // no `format` method at all), so an unformatted tag is refused, exactly as Android
        // deliberately refuses rather than formatting-then-writing blind.
        guard status != .notSupported else {
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedNotFormatted)
            return
        }
        let writable = status == .readWrite

        // ---- 2. the decision, in code the checks can run on a laptop --------------------
        switch NdefTag.plan(locationId: locationId, capacity: capacity, writable: writable) {
        case .badId:
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedBadId)
        case .readOnly:
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedReadOnly)
        case .notWritable:
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedNoCapacity)
        case .tooSmall(let needed, let capacity):
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedTooSmall(needed: needed, capacity: capacity))
        case .write(let bytes, let uri, let id):
            await performWrite(bytes: bytes, uri: uri, locationId: id, capacity: capacity, ndefTag: ndefTag, session: session)
        }
    }

    private func performWrite(
        bytes: [UInt8], uri: String, locationId: String, capacity: Int,
        ndefTag: NFCNDEFTag, session: NFCTagReaderSession
    ) async {
        // ---- 3. WHAT THE CARD ALREADY SAYS (TASK-220) -----------------------------------
        let existing: WriteGuard.Existing
        do {
            let message = try await ndefTag.readNDEF()
            existing = WriteGuard.classify(records: Self.decode(message))
        } catch let error as NSError
            where error.domain == NFCErrorDomain
                && error.code == NFCReaderError.ndefReaderSessionErrorZeroLengthMessage.rawValue {
            // CoreNFC's own "this tag holds no NDEF message" signal - a blank tag, not a
            // failure. See NFCError.h: this is raised by ANY NFCNDEFTag.readNDEF, not only
            // NFCNDEFReaderSession, despite the name.
            existing = .blank
        } catch {
            session.invalidate(errorMessage: String(localized: "Couldn't read this tag. Try again."))
            finish(.lost(reason: "\(error)"))
            return
        }

        switch WriteGuard.decide(existing: existing, offered: locationId, confirmedFor: confirmedOverwriteOf) {
        case .occupied(let onTag, let offered, let token):
            session.invalidate(errorMessage: String(localized: "Not written - see the app for details."))
            finish(.refusedOccupied(onTag: onTag, offered: offered, token: token))
            return
        case .proceed:
            break
        }

        // ---- 4. the write ----------------------------------------------------------------
        // `bytes` is header (4) + payload; CoreNFC builds its OWN header from typeNameFormat
        // + type + identifier + payload, so only the payload slice travels across - the
        // read-back in step 5 reconstructs the header again and compares the WHOLE array.
        let payload = Array(bytes[4...])
        let record = NFCNDEFPayload(
            format: .nfcWellKnown, type: Data([NdefTag.typeURI]), identifier: Data(), payload: Data(payload)
        )
        let message = NFCNDEFMessage(records: [record])
        do {
            try await ndefTag.writeNDEF(message)
        } catch {
            // The card may now hold a partial message. Say so; do not guess.
            session.invalidate(errorMessage: String(localized: "Not verified - see the app for details."))
            finish(.unverified(reason: "\(error)"))
            return
        }

        // ---- 5. read it back and compare, RECONSTRUCTED byte for byte --------------------
        let readBack: NFCNDEFMessage?
        do {
            readBack = try await ndefTag.readNDEF()
        } catch {
            session.invalidate(errorMessage: String(localized: "Not verified - see the app for details."))
            finish(.unverified(reason: "\(error)"))
            return
        }
        let readBackRecords = Self.decode(readBack)
        let reconstructed = readBackRecords?.count == 1
            ? NdefTag.reencodeShortWellKnownURI(payload: readBackRecords![0].payload)
            : nil
        guard NdefTag.verified(written: bytes, readBack: reconstructed) else {
            session.invalidate(errorMessage: String(localized: "Not verified - see the app for details."))
            finish(.unverified(reason: reconstructed == nil ? "empty" : "mismatch"))
            return
        }
        // Belt and braces, and cheap: the card's own bytes, decoded and put through the
        // SAME parser a tap uses. Byte equality already implies this - but it implies it
        // via an argument, and this asserts it via the card.
        guard let uriBack = NdefTag.uriFrom(reconstructed),
              let urlBack = URL(string: uriBack),
              TagLink.locationId(from: urlBack) == locationId
        else {
            session.invalidate(errorMessage: String(localized: "Not verified - see the app for details."))
            finish(.unverified(reason: "parse"))
            return
        }

        session.alertMessage = String(localized: "Written and checked.")
        session.invalidate()
        finish(.written(locationId: locationId, uri: uri, bytes: bytes.count, capacity: capacity, replaced: existing))
    }

    // MARK: - mapping CoreNFC's tag/error shapes onto ours

    private static func ndefTag(from tag: NFCTag) -> (any NFCNDEFTag)? {
        switch tag {
        case .feliCa(let t): return t
        case .iso7816(let t): return t
        case .iso15693(let t): return t
        case .miFare(let t): return t
        @unknown default: return nil
        }
    }

    /// `NFCNDEFMessage.records` -> our platform-independent [NdefTag.DecodedRecord]. `nil`
    /// input (no message at all) maps to `nil` output, matching `WriteGuard.classify`'s
    /// "no records at all = blank" rule.
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
            return .lost(reason: nsError.localizedDescription)
        }
        switch code {
        case .readerErrorSecurityViolation:
            // The entitlement is missing from this build (docs/NFC-WRITE-SETUP.md). Not a
            // crash, not a write attempt - the owner's Xcode click is still pending.
            return .unavailable(message: String(localized:
                "Tag writing isn't switched on in this build. Ask the developer to enable the NFC Tag Reading capability in Xcode - see docs/NFC-WRITE-SETUP.md."))
        case .readerSessionInvalidationErrorUserCanceled:
            return .lost(reason: "cancelled")
        default:
            return .lost(reason: nsError.localizedDescription)
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
