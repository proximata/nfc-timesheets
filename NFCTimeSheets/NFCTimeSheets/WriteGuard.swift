//
//  WriteGuard.swift
//  NFCTimeSheets
//
//  MAY THIS CARD BE OVERWRITTEN? The decision only - no CoreNFC, no tag, no bytes written,
//  so checks/write-guard-check.swift can execute every case of it on a laptop. A faithful
//  port of android/.../core/WriteGuard.kt (decision-49, TASK-220's guard).
//
//  WHAT WENT WRONG WITHOUT IT (TASK-220): a card ALREADY CARRYING one of our location ids,
//  presented to the write screen, was overwritten with the fresh unbound id the screen
//  happened to be offering, and the screen said "written and checked". A card that holds
//  one of our ids is a card somebody screwed to a wall. Overwriting it turns that door into
//  a dead tag for every cleaner until an admin claims the new id, and nothing on the phone
//  said a word.
//
//  NdefTag.plan() cannot catch this and should not try: it decides from the tag's own
//  physical facts and deliberately takes no URI argument. What the card ALREADY SAYS is a
//  different question with a different answer, so it is asked here, and asked BEFORE the
//  write - see TagWriter.swift's five-step order.
//
//  THE THREE KINDS OF CARD ARE NOT THE SAME KIND OF RISK:
//
//    Existing.blank    nothing on it. The ordinary case. Writes, no question asked.
//    Existing.foreign  content that is not ours. Overwriting it destroys nothing of ours,
//                      so it still writes; the screen says what was on it.
//    Existing.ours     one of our location ids. THIS IS A MOUNTED CARD until proven
//                      otherwise. Refused, unless the operator confirms THIS id.
//
//  THE CONFIRMATION IS SPECIFIC, NOT A SHRUG. [token] makes the operator read the id that
//  is about to be destroyed off the screen and type its last six characters back, and
//  [confirms] accepts nothing else. A confirmation is bound to ONE id: confirming card A
//  and then presenting card B refuses again, because [decide] compares the confirmed id to
//  the id on the card in the field, never to "the operator confirmed something recently".
//
//  ONE DIVERGENCE FROM THE KOTLIN FILE. Android's `classify` takes the raw bytes off the
//  card PLUS the platform's own loose decode as a second opinion, because Android's
//  NdefRecord.toUri() is a genuinely separate decoder from the strict one this app writes
//  with. CoreNFC gives no raw bytes at all (see NdefTag.swift's header) - only the
//  structured `NFCNDEFPayload` fields it already parsed - so there is no second, looser
//  decoder to consult here. `classify` below applies NdefTag's ONE strict decode to those
//  fields. Consequence, named rather than hidden: a card of ours written in long form by
//  some other tool, or on a legacy host TagLink no longer accepts, classifies as `foreign`
//  here where Android's loosest-reading rule might call it `ours`. Not fixed in this pass;
//  see decision-49's own risk list.
//
//  NOTHING HERE IS ON THE CLOCK-IN PATH. This file is called from TagWriter.swift only,
//  which exists solely to write a card. A tap goes through TagLink.locationId(from:) and
//  nothing else.
//

import Foundation

enum WriteGuard {

    /// What the card in the field is already carrying, read before anything is written.
    enum Existing: Equatable {
        /// No NDEF message at all: a blank, or a freshly formatted card.
        case blank
        /// A location id this app would accept from a tap.
        case ours(locationId: String)
        /// Readable or not, it is not ours. `summary` is for the operator, never parsed.
        case foreign(summary: String)
    }

    /// The verdict, and what the screen has to say about it.
    enum Verdict: Equatable {
        /// Write. `replacing` is what is about to be lost, for the record and the screen.
        case proceed(replacing: Existing)
        /// REFUSED, before any write. The card holds `onTag`; the screen was offering
        /// `offered`. `token` is what the operator must type to override it.
        case occupied(onTag: String, offered: String, token: String)
    }

    /// Shown when a card holds bytes we cannot make any sense of. Never parsed back.
    static let unreadable = "unlesbar"

    /// What the records off the card mean, or `nil`/empty for a blank tag.
    ///
    /// `records` is `nil` (no NDEF message at all - CoreNFC's own "zero length message"
    /// signal) or empty for [Existing.blank]. Otherwise NdefTag's strict record-level
    /// decode is tried; failing that, the card is [Existing.foreign] with a diagnostic
    /// summary built from what CoreNFC DID hand back (never raw bytes - see this file's
    /// header for why not).
    static func classify(records: [NdefTag.DecodedRecord]?) -> Existing {
        guard let records, !records.isEmpty else { return .blank }
        guard let uri = NdefTag.uriFrom(records: records) else {
            return .foreign(summary: summarize(records))
        }
        if let url = URL(string: uri), let id = TagLink.locationId(from: url) {
            return .ours(locationId: id)
        }
        return .foreign(summary: uri)
    }

    /// A diagnostic line for a card that does not decode as one of ours - record count,
    /// TNF and payload size/hex. Never parsed back; the screen only ever displays it.
    private static func summarize(_ records: [NdefTag.DecodedRecord]) -> String {
        guard records.count == 1 else { return "\(records.count) Datensätze" }
        let r = records[0]
        let typeHex = NdefTag.hex(r.type)
        return "TNF \(r.typeNameFormatRaw), Typ " +
            "\(typeHex.isEmpty ? "-" : typeHex), \(r.payload.count) Byte (\(NdefTag.hex(r.payload)))"
    }

    /// May `offered` be written over `existing`?
    ///
    /// - Parameter confirmedFor: the location id the operator has explicitly confirmed
    ///   destroying, or nil. Compared against the id ON THE CARD, so a confirmation
    ///   cannot drift onto the next card presented.
    static func decide(existing: Existing, offered: String?, confirmedFor: String? = nil) -> Verdict {
        guard case .ours(let onTag) = existing else { return .proceed(replacing: existing) }

        // THE RETRY PATH, and it must survive. A write that verified badly leaves a card
        // holding our id, and the fix is to present it again and write the SAME id over
        // it. Refusing that would leave a half-written card unrepairable in the field.
        if let offered, let want = TagLink.normalizedUUID(offered), want == onTag {
            return .proceed(replacing: existing)
        }
        if let confirmedFor, TagLink.normalizedUUID(confirmedFor) == onTag {
            return .proceed(replacing: existing)
        }
        return .occupied(onTag: onTag, offered: offered.flatMap(TagLink.normalizedUUID) ?? "", token: token(onTag))
    }

    /// What the write actually DESTROYED, for the screen.
    ///
    /// A card already carrying the id being offered is this operation's OWN earlier
    /// attempt - the retry path in [decide], reached after a write that verified fine but
    /// whose report to the office failed, and which the operator repaired by presenting the
    /// same card again. Reporting that as "this card held one of our own ids before: <the
    /// id you just wrote>" is a false collision: it names the card as somebody's mounted
    /// door when it is in fact the card in the operator's hand, one attempt ago. Nothing of
    /// ours was lost, so nothing is claimed.
    static func replacedForReport(existing: Existing, offered: String) -> Existing {
        guard case .ours(let onTag) = existing, TagLink.normalizedUUID(offered) == onTag else {
            return existing
        }
        return .blank
    }

    /// The six characters the operator must type to destroy `locationId`.
    ///
    /// The LAST six of the uuid, not the first: the first characters of two ids are what a
    /// tired eye compares, the last are what it has to actually read off the card's own
    /// line on the screen. Six of hex is 1 in 16 million by accident and four seconds on
    /// purpose.
    static func token(_ locationId: String) -> String {
        String(locationId.suffix(tokenLength)).lowercased()
    }

    /// Does what the operator typed authorise destroying `locationId`?
    ///
    /// Case and surrounding space are forgiven; nothing else is - not the id the screen is
    /// OFFERING (right there on the same screen, and the obvious wrong thing to copy).
    static func confirms(locationId: String?, typed: String?) -> Bool {
        guard let raw = locationId, let id = TagLink.normalizedUUID(raw) else { return false }
        guard let entered = typed?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !entered.isEmpty
        else { return false }
        return entered == token(id) || entered == id
    }

    private static let tokenLength = 6
}
