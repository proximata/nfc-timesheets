package io.github.qwadratic.nfctimesheets.notify

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.github.qwadratic.nfctimesheets.AppLocale
import io.github.qwadratic.nfctimesheets.MainActivity
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.core.RunningShift
import io.github.qwadratic.nfctimesheets.core.ShiftSignal
import java.time.Instant

/**
 * The out-of-app signal on Android: ONE ongoing notification whose elapsed time the system
 * ticks, plus an escalating ladder of reminders.
 *
 * ## Why there is no foreground service, and why there must not be one
 *
 * A foreground service exists to keep a PROCESS alive. Nothing here needs a live process:
 * `setUsesChronometer(true)` makes the SYSTEM draw the running time, and the shift's truth
 * is on the server. A notification is owned by NotificationManager, so it survives a
 * task-swipe and process death — strictly BETTER than an FGS, which OEM battery managers
 * kill.
 *
 * It would also buy exactly zero extra visibility. Google: *"Apps don't need to request
 * the POST_NOTIFICATIONS permission in order to launch a foreground service. However, apps
 * must include a notification"* — and non-exempt FGS notifications are inside that same
 * permission gate. In exchange it would cost a Play App-content declaration with a
 * demonstration video, a `specialUse` subtype property, and *"All foreground service types
 * are subject to review"* on a personal Play account (decision-27).
 *
 * **Adding any FOREGROUND_SERVICE permission to the manifest is a review-gate block.**
 *
 * ## What is honest to promise
 *
 * "It is on your lock screen", never "you cannot get rid of it". Android 14 changed
 * `FLAG_ONGOING_EVENT` so users CAN dismiss ongoing notifications while the phone is
 * unlocked. It still resists *Clear all* and stays put on the lock screen. A dismissed one
 * is reposted on the next app foreground, and cannot be reposted while no process runs.
 *
 * ## The one rule
 *
 * CLOCKING IN IS NEVER BLOCKED. [arm] is called AFTER the local row is written, it never
 * throws, it never awaits, and a denied permission arms nothing and rejects nothing.
 */
object ShiftSignals {

    private const val CHANNEL_ID = "shift"

    /** The persistent one. Replaced, never stacked: one shift, one notification. */
    private const val ONGOING_ID = 1

    /** The escalating reminder. One id, so each rung REPLACES the last instead of piling up. */
    private const val REMINDER_ID = 2

    internal const val EXTRA_HOUR = "hour"
    internal const val EXTRA_LOCATION = "location"

    /**
     * EVERY USER-VISIBLE STRING IN THIS FILE COMES FROM HERE (TASK-268).
     *
     * A notification has no Activity, and AppLocale.wrap is installed in
     * `attachBaseContext` on the UI Activities ONLY — the Application object is
     * deliberately untouched (see AppLocale.kt), so `applicationContext.getString`
     * resolves against the OS locale, not the picker. Measured: a worker who picked
     * English in Einstellungen got an English app and German shift reminders; the
     * reverse held on an English phone that picked Deutsch.
     *
     * Resolved at the point of USE and never cached: the choice can change between two
     * arms, and a cached Context would keep posting the old language until the process
     * died. AppLocale.wrap hands back `context` itself for Choice.SYSTEM, so a phone
     * that never opened the picker behaves exactly as it did before this existed.
     */
    internal fun strings(context: Context): Context =
        AppLocale.wrap(context.applicationContext)

    /**
     * Arm every out-of-app signal for [running], or tear all of them down when it is null.
     *
     * Unconditional and idempotent on purpose: it is cheaper to re-state the world than to
     * track what changed, and "did anything change" is exactly the bookkeeping that leaves
     * an orphaned notification on the lock screen after an auto-close.
     */
    fun arm(context: Context, running: RunningShift?, now: Instant = Instant.now()) {
        val app = context.applicationContext
        val plan = ShiftSignal.plan(running, now)
        val manager = NotificationManagerCompat.from(app)

        if (running == null || !plan.ongoingNotification) {
            manager.cancel(ONGOING_ID)
            manager.cancel(REMINDER_ID)
            cancelLadder(app)
            return
        }

        ensureChannel(app)
        val text = strings(app)
        val overdue = plan.phase == ShiftSignal.Phase.OVERDUE
        val where = running.locationName ?: text.getString(R.string.unknown_location)

        val builder = NotificationCompat.Builder(app, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_shift)
            .setContentTitle(
                text.getString(
                    if (overdue) R.string.notify_overdue_title else R.string.notify_running_title,
                    where,
                ),
            )
            .setContentText(
                text.getString(
                    if (overdue) R.string.notify_overdue_body else R.string.notify_running_body,
                ),
            )
            // State in TEXT, never colour alone — this is the accessibility rule applied to
            // a surface a screen reader reads out of context.
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    text.getString(
                        if (overdue) R.string.notify_overdue_body else R.string.notify_running_body,
                    ),
                ),
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            // Readable on a lock screen without unlocking: this is where it does its work.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(app))

        if (!overdue) {
            // THE SYSTEM ticks this. No service, no wakelock, no alarm, no battery.
            builder.setWhen(running.startTime.toEpochMilli())
                .setUsesChronometer(true)
                .setShowWhen(true)
        } else {
            // No running clock on a shift the 8h timer has closed: it would be a lie about
            // a row that is already out of payroll until a human fixes it (decision-10).
            builder.setUsesChronometer(false).setShowWhen(false)
        }

        // Silently a no-op when POST_NOTIFICATIONS was denied on API 33+. That is the
        // designed degradation: weaker signal, nothing broken, in-app shift screen intact.
        manager.notify(ONGOING_ID, builder.build())

        if (plan.remindersScheduled) {
            scheduleLadder(app, running)
        } else {
            cancelLadder(app)
            manager.cancel(REMINDER_ID)
        }
    }

    /** True when the OS will show nothing outside the app. Said once, on the shift screen. */
    fun outOfAppSignalsSilenced(context: Context): Boolean =
        !NotificationManagerCompat.from(context.applicationContext).areNotificationsEnabled()

    // ---- when it is fair to ask for the permission -----------------------------------
    //
    // Two booleans on disk, and the rule that reads them is in core/ShiftSignal so it can
    // be proven without a device. SharedPreferences rather than a table: this is UI state
    // about a dialog, not somebody's hours.

    private const val PREFS = "signals"
    private const val KEY_CLOCKED_IN = "hasClockedIn"
    private const val KEY_ASKED = "askedForNotifications"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun hasClockedIn(context: Context): Boolean = prefs(context).getBoolean(KEY_CLOCKED_IN, false)

    fun markClockedIn(context: Context) {
        prefs(context).edit().putBoolean(KEY_CLOCKED_IN, true).apply()
    }

    fun wasAsked(context: Context): Boolean = prefs(context).getBoolean(KEY_ASKED, false)

    fun markAsked(context: Context) {
        prefs(context).edit().putBoolean(KEY_ASKED, true).apply()
    }

    // ---- the ladder ------------------------------------------------------------------

    /**
     * Inexact alarms (`setWindow`), deliberately. An exact alarm needs
     * SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM, which Play polices and which nothing here
     * justifies: nobody cares whether the 5-hour nudge lands at 11:02 or 11:14.
     *
     * Rungs already in the past are skipped, so re-arming four hours into a shift after a
     * reboot schedules 5h, 6h, 7h and 8h and nothing else.
     */
    private fun scheduleLadder(context: Context, running: RunningShift) {
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val now = System.currentTimeMillis()
        val where = running.locationName ?: strings(context).getString(R.string.unknown_location)
        for (hour in ShiftSignal.REMINDER_HOURS) {
            val fireAt = running.startTime.toEpochMilli() + hour * 3_600_000L
            val intent = rungIntent(context, hour, where)
            if (fireAt <= now) {
                alarms.cancel(intent)
                continue
            }
            // 15 minutes of slack: the same order of magnitude as nfc-autoclose.timer's
            // own 15-minute cadence, so the 8h rung and the server's close stay in step.
            alarms.setWindow(AlarmManager.RTC_WAKEUP, fireAt, 15 * 60_000L, intent)
        }
    }

    private fun cancelLadder(context: Context) {
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        for (hour in ShiftSignal.REMINDER_HOURS) {
            alarms.cancel(rungIntent(context, hour, where = ""))
        }
    }

    /**
     * One PendingIntent per rung, keyed by requestCode so they do not collide.
     *
     * FLAG_UPDATE_CURRENT because the building name can change between arms (a switch).
     * FLAG_IMMUTABLE because API 31+ demands one of immutable/mutable and nothing outside
     * this app has any business filling in which shift a reminder is about.
     *
     * Cancelling matches on requestCode and Intent.filterEquals - which ignores extras -
     * so cancelLadder can pass an empty building name and still cancel the real alarm.
     */
    private fun rungIntent(context: Context, hour: Int, where: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            hour,
            Intent(context, ShiftReminderReceiver::class.java)
                .putExtra(EXTRA_HOUR, hour)
                .putExtra(EXTRA_LOCATION, where),
            PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag,
        )

    /** Posted by [ShiftReminderReceiver] when a rung fires. */
    internal fun postReminder(context: Context, hour: Int, where: String) {
        ensureChannel(context)
        val text = strings(context)
        val autoClose = ShiftSignal.isAutoCloseWarning(hour)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_shift)
            .setContentTitle(
                text.getString(
                    if (autoClose) R.string.notify_autoclose_title else R.string.notify_reminder_title,
                ),
            )
            .setContentText(
                if (autoClose) {
                    text.getString(R.string.notify_autoclose_body, where)
                } else {
                    text.getString(R.string.notify_reminder_body, hour, where)
                },
            )
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
        NotificationManagerCompat.from(context).notify(REMINDER_ID, builder.build())
    }

    // ---- plumbing --------------------------------------------------------------------

    private fun openApp(context: Context): PendingIntent {
        // No tag data: this only opens the app. A notification must never be a second way
        // to clock in or out — the tag is the only one (decision-19/21).
        val intent = Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag,
        )
    }

    /**
     * IMPORTANCE_DEFAULT, not HIGH: this is a status, not an emergency, and a heads-up
     * banner every time the app re-arms would be intolerable. Creating a channel that
     * already exists is a documented no-op, so this is called on every post rather than
     * once at startup — the "once at startup" version silently stops working the day
     * somebody reorders Application.onCreate.
     */
    private fun ensureChannel(context: Context) {
        // API 26+ only. Before Oreo there are no channels at all: importance came from the
        // notification itself, so there is nothing to create and nothing to fail. Returning
        // early is the whole compatibility story here.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = notificationManager(context) ?: return
        val text = strings(context)
        val channel = NotificationChannel(
            CHANNEL_ID,
            text.getString(R.string.notify_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = text.getString(R.string.notify_channel_description)
            setShowBadge(true)
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * getSystemService(Class) is API 23. The string-keyed overload works on every level we
     * support, so it is used unconditionally rather than branching — one path is one thing
     * that can break.
     */
    private fun notificationManager(context: Context): NotificationManager? =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

    /**
     * FLAG_IMMUTABLE is API 23, and API 31+ *requires* one of immutable/mutable. Below 23
     * the flag does not exist and the PendingIntent is mutable — acceptable here only
     * because these intents carry no extras, so there is nothing for a malicious filler to
     * fill. Do not add extras to them without revisiting this.
     */
    private val immutableFlag: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
}
