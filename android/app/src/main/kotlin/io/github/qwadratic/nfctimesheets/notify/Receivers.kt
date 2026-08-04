package io.github.qwadratic.nfctimesheets.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication
import io.github.qwadratic.nfctimesheets.core.RunningShift

/**
 * A rung of the reminder ladder fired. Posts one notification and nothing else — no
 * network, no database, no coroutine. This runs with the app not necessarily in memory,
 * so it must be finished by the time onReceive returns.
 */
class ShiftReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val hour = intent.getIntExtra(ShiftSignals.EXTRA_HOUR, 0)
        if (hour <= 0) return
        val where = intent.getStringExtra(ShiftSignals.EXTRA_LOCATION)
            ?.takeIf { it.isNotBlank() }
            ?: context.getString(R.string.unknown_location)
        ShiftSignals.postReminder(context, hour, where)
    }
}

/**
 * A REBOOT CLEARS EVERY NOTIFICATION. That is the one recovery gap Android has and iOS
 * does not, and it is ~20 lines to close: read the open shift out of the local queue and
 * repost. No network, so it works in a basement and cannot be delayed by a dead server.
 *
 * NOT DELIVERED TO A FORCE-STOPPED APP. If the worker swiped the app away in a way that
 * put it in the stopped state and then rebooted, nothing here runs and the signal is gone
 * until they open the app. There is no fix for that; there is only not lying about it.
 *
 * RECEIVE_BOOT_COMPLETED is a normal, install-time permission: no dialog, nothing to deny,
 * nothing on the clock-in path.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as? TimeSheetsApplication ?: return

        // goAsync + a thread: onReceive runs on the main thread and SQLite there is an ANR
        // waiting for a slow flash chip on a phone that has just booted.
        val pending = goAsync()
        Thread {
            try {
                val open = app.store.openShift()
                ShiftSignals.arm(
                    app,
                    open?.let {
                        RunningShift(
                            locationId = it.locationId,
                            locationName = app.store.locationNames()[it.locationId],
                            startTime = it.startTime,
                            serverAutoClosed = it.needsResolution,
                        )
                    },
                )
            } catch (_: Exception) {
                // A reposted notification is a nicety. Crashing the boot broadcast over it
                // would be worse than the missing notification.
            } finally {
                pending.finish()
            }
        }.start()
    }
}
