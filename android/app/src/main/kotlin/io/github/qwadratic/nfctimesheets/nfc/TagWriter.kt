package io.github.qwadratic.nfctimesheets.nfc

import android.nfc.FormatException
import android.nfc.NdefMessage
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import io.github.qwadratic.nfctimesheets.core.NdefTag
import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WriteGuard
import io.github.qwadratic.nfctimesheets.core.Zones

/**
 * THE ONE PLACE THIS APP MODIFIES A PHYSICAL OBJECT.
 *
 * Everything else in this codebase can be re-run. A write cannot: the operator is standing
 * in a client's stairwell with a card in one hand, and a card that has been written wrongly
 * is rubbish, plus a return visit. So the order below is not an implementation detail, it is
 * the whole design:
 *
 *   1. read the tag's own facts        — capacity, writability. NOTHING is written yet.
 *   2. DECIDE, in pure code            — core/NdefTag.plan(), which android/checks can run
 *   3. read WHAT THE CARD ALREADY SAYS — and refuse a card that carries one of OUR ids
 *   4. only then write                 — and only the exact byte array the decision carried
 *   5. read the card back and COMPARE  — byte for byte, against what we believe we wrote
 *
 * Step 2 is where the 46-byte tag is refused. That number is not hypothetical: the tag
 * already mounted at HOIV holds 46 bytes, our message is 64, and a phone that wrote anyway
 * would leave a card holding neither the old content nor the new.
 *
 * Step 3 is TASK-220, and it is the only step that protects a card that is ALREADY WORKING.
 * Steps 1, 2 and 5 all guard the card in the operator's hand; none of them had anything to
 * say about the card on the wall, so presenting a mounted tag overwrote it and reported
 * success. The question "what is on this card already" is answered in core/WriteGuard.kt,
 * off-device, and a card holding one of our ids is refused until the operator types back
 * the six characters of the id they are about to destroy.
 *
 * Step 5 is not decoration. `writeNdefMessage` returning without throwing means the tag
 * acknowledged the writes, not that the bytes are correct — a card pulled out of the field
 * mid-write, a flaky NTAG clone, or a tag someone else's phone also touched all produce a
 * silent success. The only statement worth making about a card about to be screwed to a
 * wall is that it was read back and matched.
 *
 * WHAT IS NEVER DONE HERE: `makeReadOnly()`. Tags stay UNLOCKED (decision-15) — locking is
 * irreversible and the migration insurance is worth more than the non-protection locking
 * would buy, since a serial and a URL are both public anyway and neither authenticates
 * anything (the worker comes from the session, always).
 */
class TagWriter(private val tagLink: TagLink) {

    /**
     * Everything the screen and the reporter need. One type, so there is no path on which
     * "it worked" is inferred from the absence of an error.
     */
    sealed interface Outcome {

        /** Written AND read back byte-identical. The ONLY outcome that may be reported. */
        data class Written(
            val locationId: String,
            val uri: String,
            val serial: String,
            val bytes: Int,
            val capacity: Int,
            /**
             * What the card held BEFORE this write — normally [WriteGuard.Existing.Blank].
             * Carried so the screen can say "this card was not empty" instead of leaving
             * the operator to find out from a door that stopped working.
             */
            val replaced: WriteGuard.Existing = WriteGuard.Existing.Blank,
        ) : Outcome

        /** Refused BEFORE any write. The card is untouched. */
        sealed interface Refused : Outcome {
            data class TooSmall(val needed: Int, val capacity: Int, val serial: String) : Refused
            data class ReadOnly(val serial: String) : Refused

            /** NDEF-capable but the platform reports no usable capacity. */
            data class NoCapacity(val serial: String) : Refused

            /**
             * Not NDEF-formatted. Deliberately refused rather than formatted blind: an
             * unformatted tag reports NO capacity until it has been formatted, so the
             * capacity gate above cannot run, and formatting-then-writing a tag too small
             * is precisely the half-write this class exists to prevent. Format it once with
             * any tag tool and present it again — it then arrives as an ordinary Ndef tag
             * with a capacity we can check.
             */
            data class NotFormatted(val serial: String, val techs: List<String>) : Refused

            /** We could not even encode a message for this id. A bug, surfaced not swallowed. */
            data class BadId(val locationId: String?) : Refused

            /**
             * THE CARD IS ALREADY ONE OF OURS, and it carries a DIFFERENT id from the one
             * being offered — i.e. it is almost certainly screwed to a wall and working.
             * Refused before any write (TASK-220). [token] is what the operator must type
             * to override it; see core/WriteGuard.
             */
            data class Occupied(
                val serial: String,
                val onTag: String,
                val offered: String,
                val token: String,
            ) : Refused
        }

        /**
         * The write was ATTEMPTED and did not verify. THE CARD IS SUSPECT — it may hold a
         * partial message. It must be re-presented (a second write over a big-enough tag is
         * harmless and fixes it) or discarded. Never reported to the server.
         */
        data class Unverified(val serial: String, val reason: String, val onTag: String?) : Outcome

        /** The tag left the field, or the transport failed, at some point. Nothing claimed. */
        data class Lost(val serial: String, val reason: String) : Outcome
    }

    /**
     * Write [locationId] onto [tag]. Blocking; call off the main thread (reader-mode
     * callbacks already arrive off it).
     *
     * @param confirmedOverwriteOf the location id the OPERATOR has explicitly confirmed
     *        destroying, typed back character by character on the screen. Null on every
     *        ordinary write. It authorises exactly that one id: presenting a different
     *        mounted card is refused again, because [WriteGuard.decide] compares it against
     *        the id read off the card in the field and not against "something was confirmed".
     */
    fun write(tag: Tag, locationId: String?, confirmedOverwriteOf: String? = null): Outcome {
        val serial = Zones.normaliseSerial(tag.id.joinToString("") { "%02X".format(it) }) ?: "?"
        val techs = tag.techList.map { it.substringAfterLast('.') }

        // NdefFormatable is looked up only to make the refusal message honest about which
        // kind of not-NDEF this is; either way we refuse, because neither can be asked for
        // a capacity before it is written to.
        val ndef = Ndef.get(tag) ?: return Outcome.Refused.NotFormatted(
            serial = serial,
            techs = if (NdefFormatable.get(tag) != null) techs + "formattable" else techs,
        )

        try {
            ndef.connect()
        } catch (e: Exception) {
            return Outcome.Lost(serial, e.javaClass.simpleName)
        }

        try {
            // ---- 1. the tag's own facts, read before anything is decided ---------------
            val capacity = ndef.maxSize
            val writable = ndef.isWritable

            // ---- 2. the decision, in code that runs on a laptop ------------------------
            val plan = NdefTag.plan(tagLink, locationId, capacity = capacity, writable = writable)
            when (plan) {
                is NdefTag.Plan.BadId -> return Outcome.Refused.BadId(locationId)
                is NdefTag.Plan.ReadOnly -> return Outcome.Refused.ReadOnly(serial)
                is NdefTag.Plan.NotWritable -> return Outcome.Refused.NoCapacity(serial)
                is NdefTag.Plan.TooSmall ->
                    return Outcome.Refused.TooSmall(plan.needed, plan.capacity, serial)
                is NdefTag.Plan.Write -> Unit
            }
            val write = plan as NdefTag.Plan.Write

            // THE PLATFORM GETS THE LAST WORD ON VALIDITY, NOT ON CONTENT. Our bytes are
            // handed to the platform parser and must survive it unchanged. If this build of
            // Android would serialise them even one byte differently, we do not write:
            // the array android/checks asserts and the array on the card are the same array
            // or there is no card.
            val message = try {
                NdefMessage(write.bytes)
            } catch (_: Exception) {
                return Outcome.Refused.BadId(locationId)
            }
            if (!message.toByteArray().contentEquals(write.bytes)) {
                return Outcome.Refused.BadId(locationId)
            }

            // ---- 3. WHAT THE CARD ALREADY SAYS (TASK-220) ------------------------------
            // A live RE-READ, never cachedNdefMessage: the cache is what the tag said at
            // dispatch time, and deciding whether to destroy a mounted card off a cache is
            // deciding off a card that may not be the one in the field any more.
            //
            // A FormatException here is CONTENT WE CANNOT PARSE, which cannot be one of
            // ours and is therefore foreign — the card is someone else's, and writing it is
            // fine. An IOException is the TAG LEAVING THE FIELD, which is Lost: nothing has
            // been written at this point, and guessing "probably blank" is exactly how a
            // mounted card gets overwritten by a phone that could not read it properly.
            val existing = try {
                val onCard = ndef.ndefMessage
                WriteGuard.classify(
                    tagLink,
                    onCard?.toByteArray(),
                    // The platform's own reading of the same card — see WriteGuard.classify.
                    // `.toString()` because the real NdefRecord.toUri() returns an
                    // android.net.Uri; checks/fake/android-nfc.kt returns the String it
                    // decodes, and both answer .toString() identically, which is why the
                    // stub can drive this line at all.
                    onCard?.records?.firstOrNull()?.toUri()?.toString(),
                )
            } catch (_: FormatException) {
                WriteGuard.Existing.Foreign(WriteGuard.UNREADABLE)
            } catch (e: Exception) {
                return Outcome.Lost(serial, e.javaClass.simpleName)
            }

            when (val verdict = WriteGuard.decide(existing, write.locationId, confirmedOverwriteOf)) {
                is WriteGuard.Verdict.Occupied -> return Outcome.Refused.Occupied(
                    serial = serial,
                    onTag = verdict.onTag,
                    offered = verdict.offered,
                    token = verdict.token,
                )
                is WriteGuard.Verdict.Proceed -> Unit
            }

            // ---- 4. the write ----------------------------------------------------------
            try {
                ndef.writeNdefMessage(message)
            } catch (e: Exception) {
                // The card may now hold a partial message. Say so; do not guess.
                return Outcome.Unverified(serial, e.javaClass.simpleName, onTag = null)
            }

            // ---- 5. read it back off the card and compare ------------------------------
            // getNdefMessage() on a connected Ndef re-reads the tag; it is not a cache.
            // cachedNdefMessage IS the dispatch-time cache and must never be used here —
            // it would compare our bytes against what the tag said BEFORE we wrote, which
            // for a tag that already held our URI would pass without a write happening.
            val readBack = try {
                ndef.ndefMessage?.toByteArray()
            } catch (e: Exception) {
                return Outcome.Unverified(serial, e.javaClass.simpleName, onTag = null)
            }

            if (!NdefTag.verified(write.bytes, readBack)) {
                return Outcome.Unverified(
                    serial = serial,
                    reason = if (readBack == null) "empty" else "mismatch",
                    onTag = readBack?.let { NdefTag.hex(it) },
                )
            }

            // Belt and braces, and cheap: the card's own bytes, decoded and put through the
            // SAME parser a tap uses. Byte equality already implies this — but it implies it
            // via an argument, and this asserts it via the card.
            if (tagLink.locationId(NdefTag.uriFrom(readBack)) != write.locationId) {
                return Outcome.Unverified(serial, "parse", readBack?.let { NdefTag.hex(it) })
            }

            return Outcome.Written(
                locationId = write.locationId,
                uri = write.uri,
                serial = serial,
                bytes = write.bytes.size,
                capacity = capacity,
                replaced = existing,
            )
        } finally {
            runCatching { ndef.close() }
        }
    }
}
