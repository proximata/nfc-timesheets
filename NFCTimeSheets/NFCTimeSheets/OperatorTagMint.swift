//
//  OperatorTagMint.swift
//  NFCTimeSheets
//
//  MINT -> WRITE -> REPORT, in ONE place (decision-55 §3, TASK-283). Two screens now need
//  a freshly written card: WriteTagScreen (a new door) and VerifyZoneScreen's Reassign
//  Building (the same door under a different building). decision-55 says the reassign runs
//  "exactly the same mint-write-report sequence Write a tag already runs" - so it runs THIS
//  function, and there is no second copy of the sequence to drift.
//
//  NO CoreNFC HERE, AND NONE IS ADDED ANYWHERE ELSE EITHER. The bytes and the overwrite
//  guard stay exactly where decision-49 put them (NdefTag.swift / WriteGuard.swift /
//  TagWriter.swift, ported clause for clause from Android). This file is a two-step
//  sequence over TagWriter and OperatorFlowAPI and nothing more.
//
//  THE REPORT IS PART OF THE SEQUENCE, not an afterthought: an id that is on a card but not
//  in `reported_tags` is a card no route will ever resolve (POST
//  /operator/tags/:id/resolve-zone and POST /operator/zones/:id/reassign-building both 404
//  on an unreported id). `reported` coming back false is therefore the one state a caller
//  must offer a retry for - it never means the card is bad.
//

import Foundation

@MainActor
enum OperatorTagMint {
    struct Result {
        /// The id that was ATTEMPTED. Only meaningful as "the id now on the card" when
        /// `outcome` is `.written`.
        let id: String
        let outcome: TagWriter.Outcome
        /// The office has the id. False when the write was refused, or when the report call
        /// itself failed - the caller retries the report, never the write.
        let reported: Bool

        var written: Bool { if case .written = outcome { return true }; return false }
    }

    /// A fresh card id. uuidv4, lowercased, minted ON THE PHONE - the same shape
    /// WriteTagScreen has always minted, kept here so the reassign flow cannot invent a
    /// second convention.
    /// `nonisolated` so it can be a @State default value, which is evaluated outside any
    /// actor - minting an id touches nothing shared.
    nonisolated static func mintId() -> String { UUID().uuidString.lowercased() }

    /// Write `id` to whatever card is presented, then tell the office about it.
    ///
    /// `onWritten` fires between the two steps, so a screen can show its write outcome while
    /// the report is still in flight instead of jumping straight from "hold your phone near
    /// the card" to "reported".
    static func writeAndReport(
        writer: TagWriter,
        id: String,
        confirmedOverwriteOf: String?,
        onWritten: (TagWriter.Outcome) -> Void = { _ in }
    ) async -> Result {
        let outcome = await OperatorFlowAPI.write(writer: writer, id: id,
                                                  confirmedOverwriteOf: confirmedOverwriteOf)
        onWritten(outcome)
        guard case .written(let writtenId, _, _, _, _) = outcome else {
            return Result(id: id, outcome: outcome, reported: false)
        }
        // The id the WRITER says landed, not the one asked for. They are the same today;
        // trusting the outcome means they cannot silently stop being.
        do {
            _ = try await OperatorFlowAPI.reportTag(id: writtenId)
            return Result(id: writtenId, outcome: outcome, reported: true)
        } catch {
            return Result(id: writtenId, outcome: outcome, reported: false)
        }
    }
}
