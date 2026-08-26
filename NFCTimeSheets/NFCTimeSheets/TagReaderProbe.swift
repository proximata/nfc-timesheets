//
//  TagReaderProbe.swift
//  NFCTimeSheets
//
//  THE TEST SCAN's read half (decision-47) - proving a mounted card resolves to a place id
//  BEFORE it is trusted as a clock-in target. Mirrors
//  android/.../nfc/VerifyZoneActivity.kt's `handleRead`, as a SEPARATE type from
//  TagWriter.swift, on purpose: this file never calls `writeNDEF` or `writeLock`, and
//  never could by construction - there is no write call anywhere below this comment.
//
//  CANNOT OPEN A SHIFT, STRUCTURALLY. This file resolves a place id and stops; it never
//  imports TapInbox.swift, never touches Sync.swift, and the id it returns goes to
//  `OperatorTagAPI.verifyZone`, which carries the `ts_operator` cookie that no
//  shift-touching route accepts (decision-45, server/routes/operator.js's own header).
//
//  ORDER: pick a zone FIRST (VerifyZoneScreen.swift), scan SECOND. `POST
//  /operator/zones/:id/verify`'s equality check - "does this card resolve to THIS zone" -
//  only means anything if the operator committed to which zone they were testing before
//  they knew what the card would say.
//
//  RESOLUTION, same shape as a real tap: a real universal-link URI through
//  `TagLink.locationId(from:)` first (an ADOPTED building-level tag), then a hardware UID
//  matched against THIS worklist's own `tagSerial` column (an adopted, URL-less zone tag) -
//  never a compiled fallback table, because this screen only ever proves a ZONE.
//

import CoreNFC
import Foundation

@MainActor
final class TagReaderProbe: NSObject, NFCTagReaderSessionDelegate {

    enum Outcome {
        /// A real universal link or a matched hardware serial resolved to this place id.
        case resolved(placeId: String)
        /// Read the tag but found nothing this app recognises - not one of ours, or not
        /// NDEF at all.
        case unreadable
        /// No session was started: this device cannot read NFC, or the capability is not
        /// enabled in this build yet. `message` is already localized.
        case unavailable(message: String)
        /// The tag left the field, or the transport failed. Nothing was resolved.
        case lost(reason: String)
    }

    private var continuation: CheckedContinuation<Outcome, Never>?
    private var session: NFCTagReaderSession?
    private var zones: [WireOperatorZone] = []
    private var finished = false

    /// Present the system NFC sheet, read whatever tag is presented, and resolve it
    /// against `zones` (the operator's own worklist, per this file's header).
    func scan(zones: [WireOperatorZone]) async -> Outcome {
        guard NFCTagReaderSession.readingAvailable else {
            return .unavailable(message: String(localized: "This iPhone can't read NFC tags."))
        }
        self.zones = zones
        finished = false
        return await withCheckedContinuation { (cont: CheckedContinuation<Outcome, Never>) in
            self.continuation = cont
            guard let session = NFCTagReaderSession(
                // .iso18092 (FeliCa) dropped - see TagWriter.swift's comment on this same line.
                pollingOption: [.iso14443, .iso15693], delegate: self, queue: nil
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

    private func process(tag: NFCTag, session: NFCTagReaderSession) async {
        do {
            try await session.connect(to: tag)
        } catch {
            finish(.lost(reason: "\(error)"))
            return
        }

        let uid = Self.identifier(of: tag)
        var placeId: String?

        if let ndefTag = Self.ndefTag(from: tag) {
            do {
                let message = try await ndefTag.readNDEF()
                let uri = NdefTag.uriFrom(records: Self.decode(message))
                placeId = uri.flatMap(URL.init(string:)).flatMap(TagLink.locationId(from:))
            } catch let error as NSError
                where error.domain == NFCErrorDomain
                    && error.code == NFCReaderError.ndefReaderSessionErrorZeroLengthMessage.rawValue {
                placeId = nil // blank - fall through to the serial match below
            } catch {
                session.invalidate(errorMessage: String(localized: "Couldn't read this tag. Try again."))
                finish(.lost(reason: "\(error)"))
                return
            }
        }

        if placeId == nil, let uid, let normalised = Zones.normaliseSerial(uid) {
            placeId = zones.first { Zones.normaliseSerial($0.tagSerial) == normalised }?.id
        }

        session.invalidate()
        if let placeId {
            finish(.resolved(placeId: placeId))
        } else {
            finish(.unreadable)
        }
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

    /// Hardware UID, uppercase hex - only MiFare/ISO7816/ISO15693 tags expose one.
    private static func identifier(of tag: NFCTag) -> String? {
        let data: Data?
        switch tag {
        case .miFare(let t): data = t.identifier
        case .iso7816(let t): data = t.identifier
        case .iso15693(let t): data = t.identifier
        case .feliCa: data = nil
        @unknown default: data = nil
        }
        guard let data else { return nil }
        return data.map { String(format: "%02X", $0) }.joined()
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
            return .lost(reason: nsError.localizedDescription)
        }
        switch code {
        case .readerErrorSecurityViolation:
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
