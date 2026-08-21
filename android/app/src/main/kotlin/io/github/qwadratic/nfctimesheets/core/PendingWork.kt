package io.github.qwadratic.nfctimesheets.core

import java.time.Instant

/**
 * WHAT THIS PHONE IS STILL HOLDING, as a pure function.
 *
 * THE BUG THIS EXISTS FOR (TASK-225). A tap in a basement is written to SQLite and, until
 * this iteration, was pushed only when a human happened to open the app. There was no
 * server row, therefore no 8h auto-close, no payroll line, and — worst of the three —
 * NOBODY COULD EVEN ASK whether it had happened. One worker is a rounding error. Twenty
 * cleaners across eight basements is a monthly shortfall in somebody's wage, discovered
 * by an argument at month end.
 *
 * [sync.ShiftSyncJob] is the delivery half. THIS is the detection half, and it is the
 * cheaper and the more important one: delivery can fail for a hundred reasons that are
 * nobody's fault, and the only unacceptable outcome is that it fails SILENTLY.
 *
 * Three readers, one number, computed once:
 *   - the worker, on the shift screen and the log screen, in German, with the time of the
 *     last attempt (a queued row that only exists in a log is the same bug in a new place)
 *   - the sign-IN screen, because signing out does not delete a queued row and the person
 *     holding the phone must not think it went away
 *   - the OFFICE, via the X-Pending-* headers net/Api.kt attaches to every request, so a
 *     director at month end sees "this phone is holding two shifts" as a fact rather than
 *     as a surprise.
 *
 * Pure and Android-free so android/checks/run.sh exercises it on a laptop with no device.
 */
object PendingWork {

    /**
     * @param waiting rows that will go out on their own, given a signal and a session.
     * @param blocked rows that will NEVER go out without a human: a shift queued under a
     *        different account, or one whose location the server refuses. Counted
     *        SEPARATELY and never folded into [waiting], because "wait for signal" and
     *        "phone the office" are opposite instructions and one sentence cannot be both.
     * @param oldestStart the start time of the oldest unsent shift, waiting or blocked.
     *        This is the number that turns into money: it is how long ago the work that
     *        the server has never heard of was actually done.
     * @param lastAttemptAt the most recent push attempt across the unsent rows, or null
     *        when nothing has ever been tried — which is itself a distinct thing to say,
     *        and the UI says it rather than printing a blank time.
     */
    data class Summary(
        val waiting: Int,
        val blocked: Int,
        val oldestStart: Instant?,
        val lastAttemptAt: Instant?,
    ) {
        val total: Int get() = waiting + blocked
        val isEmpty: Boolean get() = total == 0
    }

    val NOTHING = Summary(waiting = 0, blocked = 0, oldestStart = null, lastAttemptAt = null)

    /**
     * A row counts as pending when the SERVER has not got both halves of it yet.
     *
     * `isFullySynced` is the same predicate SyncPlan.plan() skips on, deliberately: if
     * these two ever disagree the app either nags about a shift that is safely filed, or
     * — far worse — stays quiet about one that is not. An open shift whose OPEN has landed
     * is NOT pending: the server has it, the 8h net applies to it, and it will be closed
     * by a tap that has not happened yet.
     */
    fun summarise(queue: List<SyncPlan.QueuedShift>): Summary {
        var waiting = 0
        var blocked = 0
        var oldest: Instant? = null
        var lastAttempt: Instant? = null

        for (shift in queue) {
            if (shift.isFullySynced) continue
            if (shift.syncBlocked) blocked++ else waiting++
            if (oldest == null || shift.startTime < oldest) oldest = shift.startTime
            val attempt = shift.lastAttemptAt
            if (attempt != null && (lastAttempt == null || attempt > lastAttempt)) lastAttempt = attempt
        }

        return Summary(waiting = waiting, blocked = blocked, oldestStart = oldest, lastAttemptAt = lastAttempt)
    }
}
