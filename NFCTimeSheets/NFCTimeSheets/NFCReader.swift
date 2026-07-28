//
//  NFCReader.swift
//  NFCTimeSheets
//
//  Reads the NDEF URI record written on the tag - NOT the hardware UID (decision-5).
//  The URI is a universal link carrying the location UUID (decision-21):
//
//      https://timesheets.exe.xyz/t?l=<uuid>
//
//  This in-app scan is the fallback path. The normal path is a background tap: iOS
//  reads the tag from the lock screen and opens the same link, which lands in TapInbox
//  via .onOpenURL. Both end up in the same place.
//
//  Nothing is written to the tag here. Tags are provisioned once, by hand, and left
//  unlocked as migration insurance (decision-15).
//

import Foundation
import CoreNFC
import Combine

final class NFCReader: NSObject, ObservableObject, NFCNDEFReaderSessionDelegate {
    @Published var message = "Hold your phone to the tag"
    @Published var lastLocationId: String?   // set on a good read; the View consumes + clears
    private var session: NFCNDEFReaderSession?

    func beginScanning() {
        guard NFCNDEFReaderSession.readingAvailable else {
            message = "NFC is not available on this device"
            return
        }
        session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
        session?.alertMessage = "Hold iPhone near the tag."
        session?.begin()
    }

    // MARK: NFCNDEFReaderSessionDelegate

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // A user-cancelled scan is not a failure worth shouting about.
        let code = (error as? NFCReaderError)?.code
        guard code != .readerSessionInvalidationErrorUserCanceled,
              code != .readerSessionInvalidationErrorFirstNDEFTagRead
        else { return }
        DispatchQueue.main.async { self.message = "Scan failed: \(error.localizedDescription)" }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        let ids = messages
            .flatMap(\.records)
            .compactMap(NFCReader.url(from:))
            .compactMap(TagLink.locationId(from:))

        guard let locationId = ids.first else {
            session.invalidate(errorMessage: "This tag is not a TimeSheet location tag.")
            return
        }
        session.alertMessage = "Tag read."
        session.invalidate()
        DispatchQueue.main.async {
            self.message = "Hold your phone to the tag"
            self.lastLocationId = locationId
        }
    }

    /// URI record, either well-known type "U" (what the provisioning tool writes) or an
    /// absolute-URI record. Anything else is not ours.
    private static func url(from record: NFCNDEFPayload) -> URL? {
        if let url = record.wellKnownTypeURIPayload() { return url }
        guard record.typeNameFormat == .absoluteURI,
              let text = String(data: record.payload, encoding: .utf8)
        else { return nil }
        return URL(string: text)
    }
}
