package io.github.qwadratic.nfctimesheets.core

/**
 * MAY THIS CARD BE OVERWRITTEN? The decision only — no Android, no tag, no bytes written,
 * so android/checks can execute every case of it on a laptop.
 *
 * WHAT WENT WRONG WITHOUT IT (TASK-220, found by driving the real writer against a fake
 * card pre-loaded with the live HOIV bytes): a card ALREADY CARRYING one of our location
 * ids, presented to the write screen, was overwritten with the fresh unbound id the screen
 * happened to be offering, and the screen said "Geschrieben und geprueft." That card is not
 * a blank in a pocket — a card that holds one of our ids is a card somebody screwed to a
 * wall. Overwriting it turns that door into `422` for every cleaner until an admin claims
 * the new id, and nothing on the phone said a word.
 *
 * core/NdefTag.plan() cannot catch this and should not try: it decides from the tag's own
 * physical facts (capacity, writability), and it deliberately takes no URI argument. What
 * the card ALREADY SAYS is a different question with a different answer — one that depends
 * on what a human has confirmed — so it is asked here, and asked BEFORE the write:
 *
 *     read the tag's facts -> plan() -> READ WHAT THE CARD SAYS -> decide() -> write
 *
 * THE THREE KINDS OF CARD ARE NOT THE SAME KIND OF RISK, and the operator is told which one
 * is in their hand:
 *
 *   [Existing.Blank]    nothing on it. The ordinary case. Writes, no question asked.
 *   [Existing.Foreign]  content that is not ours — a shop's URL, a vCard, a Text record,
 *                       an unformatted mess. Somebody else's rubbish, or a factory sample.
 *                       Overwriting it destroys nothing of ours, so it still writes; the
 *                       screen says what was on it so the operator is not surprised.
 *   [Existing.Ours]     one of our location ids. THIS IS A MOUNTED CARD until proven
 *                       otherwise. Refused, unless the operator confirms THIS id.
 *
 * THE CONFIRMATION IS SPECIFIC, NOT A SHRUG. "Are you sure?" is answered yes by a thumb
 * that has already stopped reading. [token] makes the operator read the id that is about to
 * be destroyed off the screen and type its last six characters back, and [confirms] accepts
 * nothing else. A confirmation is bound to ONE id: confirming card A and then presenting
 * card B refuses again, because [decide] compares the confirmed id to the id on the card in
 * the field, never to "the operator confirmed something recently".
 *
 * NOTHING HERE IS ON THE CLOCK-IN PATH. A cleaner tapping a wall never reaches this file —
 * it is called from nfc/TagWriter.kt and nfc/WriteTagActivity.kt only, both of which exist
 * solely to write a card. A tap goes through core/TagLink and nothing else.
 */
object WriteGuard {

    /** What the card in the field is already carrying, read before anything is written. */
    sealed interface Existing {

        /** No NDEF message at all: a blank, or a freshly formatted card. */
        data object Blank : Existing

        /**
         * A location id this app would accept from a tap — including on a LEGACY host,
         * because a card written before the last rename is still a card on a wall.
         */
        data class Ours(val locationId: String) : Existing

        /** Readable or not, it is not ours. [summary] is for the operator, never parsed. */
        data class Foreign(val summary: String) : Existing
    }

    /** The verdict, and what the screen has to say about it. */
    sealed interface Verdict {

        /** Write. [replacing] is what is about to be lost, for the record and the screen. */
        data class Proceed(val replacing: Existing) : Verdict

        /**
         * REFUSED, before any write. The card holds [onTag] and the screen was offering
         * [offered]. [token] is what the operator must type to override it.
         */
        data class Occupied(val onTag: String, val offered: String, val token: String) : Verdict
    }

    /** Shown when a card holds bytes we cannot make any sense of. Never parsed back. */
    const val UNREADABLE = "unlesbar"

    /**
     * What the bytes on the card mean.
     *
     * @param existing the message read OFF THE CARD, or null when it holds none.
     * @param alsoRead the same card as the PLATFORM decoder read it (`NdefRecord.toUri()`),
     *        when the caller has it. Deliberately a second opinion: core/NdefTag is strict
     *        on purpose — one short record, no ID field, nothing trailing — so a card of
     *        ours written years ago by some other tool in long form decodes to null there
     *        and would be classified Foreign, i.e. silently overwritable. The guard takes
     *        the LOOSEST reading of the card that any decoder offers, because a card
     *        wrongly called foreign is the expensive mistake and a card wrongly called ours
     *        costs six typed characters.
     */
    fun classify(tagLink: TagLink, existing: ByteArray?, alsoRead: String? = null): Existing {
        if (existing == null || existing.isEmpty()) {
            // The platform may have decoded something we could not read as bytes.
            val id = tagLink.locationId(alsoRead)
            if (id != null) return Existing.Ours(id)
            return if (alsoRead.isNullOrEmpty()) Existing.Blank else Existing.Foreign(alsoRead)
        }
        val strict = NdefTag.uriFrom(existing)
        val id = tagLink.locationId(strict) ?: tagLink.locationId(alsoRead)
        if (id != null) return Existing.Ours(id)
        return Existing.Foreign(strict ?: alsoRead ?: "${existing.size} Byte: ${NdefTag.hex(existing)}")
    }

    /**
     * May [offered] be written over [existing]?
     *
     * @param confirmedFor the location id the operator has explicitly confirmed destroying,
     *        or null. Compared against the id ON THE CARD, so a confirmation cannot drift
     *        onto the next card presented.
     */
    fun decide(existing: Existing, offered: String?, confirmedFor: String? = null): Verdict {
        if (existing !is Existing.Ours) return Verdict.Proceed(existing)

        // THE RETRY PATH, and it must survive. A write that verified badly leaves a card
        // holding our id, and the fix is to present it again and write the SAME id over it.
        // Refusing that would leave a half-written card unrepairable in the field.
        val want = TagLink.normalizedUuid(offered)
        if (want != null && want == existing.locationId) return Verdict.Proceed(existing)

        if (TagLink.normalizedUuid(confirmedFor) == existing.locationId) {
            return Verdict.Proceed(existing)
        }
        return Verdict.Occupied(
            onTag = existing.locationId,
            offered = want ?: "",
            token = token(existing.locationId),
        )
    }

    /**
     * The six characters the operator must type to destroy [locationId].
     *
     * The LAST six of the uuid, not the first: the first characters of two ids are what a
     * tired eye compares, the last are what it has to actually read off the card's own line
     * on the screen. Six of hex is 1 in 16 million by accident and four seconds on purpose.
     */
    fun token(locationId: String): String = locationId.takeLast(TOKEN_LENGTH).lowercase()

    /**
     * Does what the operator typed authorise destroying [locationId]?
     *
     * Case and surrounding space are forgiven — a phone keyboard in a stairwell capitalises
     * on its own and the operator is not being tested on typing. Nothing else is: any other
     * six characters, an empty box, or the id the screen is OFFERING (which is on the same
     * screen, right above, and is the obvious wrong thing to copy) all fail.
     */
    fun confirms(locationId: String?, typed: String?): Boolean {
        val id = TagLink.normalizedUuid(locationId) ?: return false
        val entered = typed?.trim()?.lowercase() ?: return false
        if (entered.isEmpty()) return false
        return entered == token(id) || entered == id
    }

    private const val TOKEN_LENGTH = 6
}
