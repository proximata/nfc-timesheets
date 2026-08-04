package io.github.qwadratic.nfctimesheets.core

import java.time.Duration
import java.time.Instant

/**
 * What the app believes about the shift in progress, and everything that follows from it:
 * which tabs exist, which out-of-app signals are armed, when the reminders fire.
 *
 * PURE KOTLIN, no Android imports — that is what lets android/checks/core-check.kt run it
 * on a plain JVM with no device, no emulator and no SDK. Every rule that decides whether a
 * worker is reminded to clock out lives here, where it can be proven; the platform
 * plumbing lives in notify/, where it cannot.
 *
 * MIRROR OF NFCTimeSheets/NFCTimeSheets/ShiftSignal.swift, line for line. The two files
 * are the same state machine written twice and core-check asserts the constants agree —
 * the whole point of this work is that the two platforms behave the same.
 */
object ShiftSignal {

    // ---- constants shared with the server's 8h timer ---------------------------------

    /**
     * ops/sql/autoclose.sql closes an open shift at start + 8h and nfc-autoclose.timer
     * runs it every 15 minutes (decision-10). The client computes the same boundary
     * LOCALLY and never asks the server for it: a clock-in works offline, so a
     * server-supplied deadline would be a second mechanism the client cannot rely on.
     */
    val AUTO_CLOSE_AFTER: Duration = Duration.ofHours(8)

    /**
     * Escalating reminders, in hours after the start. The last rung is the auto-close
     * itself and says something different — see [isAutoCloseWarning].
     *
     * One-shot alarms rather than one repeating one: "Sie sind seit 5 Stunden
     * eingestempelt" is worth more than eight identical pings, and an ongoing
     * notification that has been on the lock screen for five hours has become wallpaper.
     */
    val REMINDER_HOURS: List<Int> = listOf(1, 2, 3, 4, 5, 6, 7, 8)

    fun isAutoCloseWarning(hour: Int): Boolean =
        Duration.ofHours(hour.toLong()) >= AUTO_CLOSE_AFTER

    // ---- phase -----------------------------------------------------------------------

    /** Two phases and no more. */
    enum class Phase { RUNNING, OVERDUE }

    fun phase(startTime: Instant, now: Instant, serverAutoClosed: Boolean): Phase = when {
        serverAutoClosed -> Phase.OVERDUE
        !Duration.between(startTime, now).minus(AUTO_CLOSE_AFTER).isNegative -> Phase.OVERDUE
        else -> Phase.RUNNING
    }

    fun phase(running: RunningShift, now: Instant): Phase =
        phase(running.startTime, now, running.serverAutoClosed)

    /** The moment the server's timer closes this shift. */
    fun autoCloseDeadline(startTime: Instant): Instant = startTime.plus(AUTO_CLOSE_AFTER)

    // ---- the lock --------------------------------------------------------------------

    /** The tabs that exist. Order is the order they appear in the navigation bar. */
    enum class Tab { LOG, MATERIALS, HISTORY, SETTINGS }

    /**
     * THE LOCK. Not a security boundary and not a kiosk — a WORK-DISCIPLINE shape. While
     * a shift runs the app has one job and looks like it. Anyone reading this later: do
     * not mistake it for enforcement.
     *
     * History is the only thing that goes, and nothing in it is time-critical. Materials
     * stays because the worker is standing IN the building — that is exactly when they
     * need it. Settings stays because a handed-over phone must be signable-out
     * (decision-26). The resolver is not a tab: it is a card on the log screen, shown in
     * EVERY state, which is what decision-10 requires.
     */
    fun visibleTabs(shiftRunning: Boolean): List<Tab> =
        if (shiftRunning) listOf(Tab.LOG, Tab.MATERIALS, Tab.SETTINGS) else Tab.entries.toList()

    // ---- the permission moment -------------------------------------------------------

    /**
     * POST_NOTIFICATIONS, and the one place the timing rule is written down.
     *
     * NEVER on the clock-in path, never before the first successful clock-in, and never
     * at all below API 33 where the permission does not exist and notifications are on by
     * default. The alternative was asking at launch, which means asking at a door at
     * 06:02 with gloves on, before the worker has any idea what the app is for — and a
     * refusal there is permanent short of a trip into Settings.
     *
     * @param sdkInt Build.VERSION.SDK_INT, passed in so this stays testable off-device.
     */
    fun shouldAskForNotifications(sdkInt: Int, hasClockedIn: Boolean, alreadyAsked: Boolean): Boolean =
        sdkInt >= 33 && hasClockedIn && !alreadyAsked

    // ---- the plan --------------------------------------------------------------------

    /**
     * Everything the OS should be showing right now, derived from one value.
     *
     * `plan(null)` is [IDLE] — every signal off. That invariant is what keeps a closed
     * shift from leaving an ongoing notification on the lock screen, and it is why arming
     * is unconditional rather than guarded by "did anything change".
     *
     * @param ongoingNotification the persistent notification with the system-ticked
     *        chronometer. NOT a foreground service: an FGS keeps a PROCESS alive, and
     *        nothing here needs one — the elapsed time is drawn by the system and the
     *        shift's truth is on the server. It would also buy ZERO extra visibility,
     *        because Google's own docs put foreground-service notifications inside the
     *        POST_NOTIFICATIONS gate, while costing a Play content declaration, a
     *        demonstration video and review on a personal account (decision-27).
     */
    data class SignalPlan(
        val lockScreen: Boolean,
        val ongoingNotification: Boolean,
        val remindersScheduled: Boolean,
        val phase: Phase?,
    ) {
        companion object {
            val IDLE = SignalPlan(
                lockScreen = false,
                ongoingNotification = false,
                remindersScheduled = false,
                phase = null,
            )
        }
    }

    fun plan(running: RunningShift?, now: Instant): SignalPlan {
        if (running == null) return SignalPlan.IDLE
        val phase = phase(running, now)
        return SignalPlan(
            lockScreen = true,
            // Still posted when overdue, with different words: the shift is still the only
            // thing this app is about, and the worker still has to act — harder now.
            ongoingNotification = true,
            // Past 8h every rung has already fired and the server has closed the shift.
            // Re-arming would ping somebody about a shift that no longer exists.
            remindersScheduled = phase == Phase.RUNNING,
            phase = phase,
        )
    }

    // ---- spoken duration -------------------------------------------------------------

    /**
     * Hours and minutes, for the ONE static accessibility label that carries the elapsed
     * time. The ticking text on screen is `clearAndSetSemantics {}`: a per-second live
     * region makes TalkBack unusable, and a locked screen whose only content is a timer
     * is precisely where that bug would be worst.
     */
    fun elapsed(startTime: Instant, now: Instant): Pair<Int, Int> {
        val seconds = maxOf(0L, Duration.between(startTime, now).seconds)
        return (seconds / 3600).toInt() to ((seconds % 3600) / 60).toInt()
    }
}

/**
 * The open shift as the app currently understands it. Built from the LOCAL SQLite row,
 * which is what a tap in a basement writes — never from a server response, because there
 * may not have been one.
 *
 * This is the single value the signal is armed from: the tap path and
 * `ShiftSync.adoptServerOpenShift` both end in `ShiftSignals.arm(...)` with one of these,
 * so a reinstalled phone and a rebooted phone re-arm exactly like a fresh clock-in does.
 */
data class RunningShift(
    val locationId: String,
    /**
     * May be null: the roster cache is filled by the network and a tag tap does not wait
     * for it. A missing NAME is cosmetic; a missing SHIFT is unpaid work. Nothing here
     * branches on it.
     */
    val locationName: String?,
    val startTime: Instant,
    /**
     * The server has flagged this shift as auto-closed and no human has confirmed the
     * real finish time (decision-10). Forces OVERDUE regardless of the clock: a shift the
     * server has closed must never be shown with a running timer.
     */
    val serverAutoClosed: Boolean = false,
)
