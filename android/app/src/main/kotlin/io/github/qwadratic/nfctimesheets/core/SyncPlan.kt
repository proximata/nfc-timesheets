package io.github.qwadratic.nfctimesheets.core

import java.time.Instant

/**
 * The offline queue state machine, as a pure function.
 *
 * THE LOCAL ROW IS A QUEUE, THE SERVER IS THE TRUTH (decision-19). A tap in a basement
 * writes a row with no network and still counts; this decides what has to be pushed, in
 * what order, the next time there is a signal. Port of syncPending/pushOpen/pushClose in
 * NFCTimeSheets/NFCTimeSheets/Sync.swift.
 *
 * It is a pure function so android/checks can run it without a device, an emulator, an
 * Android SDK or a server. The executor that performs the steps lives in
 * data/ShiftSync.kt and does nothing this file has not already decided.
 */
object SyncPlan {

    /** One queued shift, exactly the columns ShiftStore persists. */
    data class QueuedShift(
        val clientUuid: String,
        /**
         * Who was signed in when this row was written. NEVER sent to the server — the
         * session cookie decides that (decision-22) — it is here so a row queued under
         * one account is never pushed under another one's session.
         */
        val workerId: Int,
        val locationId: String,
        val startTime: Instant,
        val endTime: Instant?,
        val autoClosed: Boolean,
        val openSyncedAt: Instant?,
        val closeSyncedAt: Instant?,
        val syncBlocked: Boolean,
        /**
         * When a push was last ATTEMPTED for this row — success or failure, both. Read
         * only by [PendingWork]; [plan] deliberately does not branch on it, because a row
         * that has been tried a hundred times and a row that has never been tried are the
         * same job to do. Defaulted so every existing construction site is unchanged.
         */
        val lastAttemptAt: Instant? = null,
    ) {
        val isOpen: Boolean get() = endTime == null
        val isFullySynced: Boolean get() = openSyncedAt != null && (isOpen || closeSyncedAt != null)
    }

    /** A call to make. `clientUuid` is the idempotency key for BOTH halves. */
    sealed interface Step {
        val clientUuid: String

        data class Open(
            override val clientUuid: String,
            val locationId: String,
            val startTime: Instant,
        ) : Step

        data class Close(
            override val clientUuid: String,
            val endTime: Instant,
            val autoClosed: Boolean,
        ) : Step
    }

    /**
     * A row that can never be sent. Terminal by construction, so it is reported once and
     * never retried — with a message the worker can act on, because a wrong name on a
     * payslip is worse than a visible failure.
     */
    data class Block(val clientUuid: String, val code: String) {
        companion object {
            /** Row from before the UUID era, or a tag that never parsed. */
            const val MISSING_LOCATION = "missing_location"
            /** Queued by a different worker on this phone. */
            const val WRONG_ACCOUNT = "wrong_account"
        }
    }

    data class Pass(val steps: List<Step>, val blocks: List<Block>)

    /**
     * ORDER MATTERS, and it is the whole reason this is not a `forEach`:
     *
     *  - oldest first. The server allows one open shift per worker, so a newer open 409s
     *    with `shift_already_open` until the older one is closed.
     *  - OPEN before CLOSE for the same shift. Closing something the server has never
     *    heard of answers 404 unknown_shift.
     *  - a shift whose OPEN fails must not have its CLOSE attempted in the same pass.
     *    The executor enforces that by dropping the remaining steps for that clientUuid;
     *    the ordering here is what makes that possible to enforce at all.
     *
     * @param sessionWorkerId the worker the SERVER says holds this session.
     */
    fun plan(queue: List<QueuedShift>, sessionWorkerId: Int): Pass {
        val steps = mutableListOf<Step>()
        val blocks = mutableListOf<Block>()

        for (shift in queue.sortedBy { it.startTime }) {
            if (shift.syncBlocked || shift.isFullySynced) continue

            if (shift.openSyncedAt == null) {
                if (TagLink.normalizedUuid(shift.locationId) == null) {
                    // Can never be posted — the server would answer 400 invalid_uuid for
                    // ever. Say so once and stop retrying it.
                    blocks += Block(shift.clientUuid, Block.MISSING_LOCATION)
                    continue
                }
                if (shift.workerId != sessionWorkerId) {
                    // The server files a shift under whoever holds the cookie. Pushing
                    // worker A's queued row while worker B is signed in would put A's
                    // hours on B's payslip — decision-22's hole, re-opened from the
                    // client side. Blocked LOUDLY instead.
                    blocks += Block(shift.clientUuid, Block.WRONG_ACCOUNT)
                    continue
                }
                steps += Step.Open(shift.clientUuid, shift.locationId, shift.startTime)
            }

            val end = shift.endTime
            if (end != null && shift.closeSyncedAt == null) {
                steps += Step.Close(shift.clientUuid, end, shift.autoClosed)
            }
        }

        return Pass(steps, blocks)
    }

    /**
     * After a step failed: does this row stop retrying?
     *
     * A failure ALWAYS leaves a message on the row. The iOS code this is ported from once
     * caught 400s into a bare `catch {}`, which left the error nil, the row looking fine
     * and the shift retrying for ever — a data-loss bug wearing a clean UI.
     */
    fun blocksRow(failure: ApiFailure): Boolean = !failure.isRetryable
}
