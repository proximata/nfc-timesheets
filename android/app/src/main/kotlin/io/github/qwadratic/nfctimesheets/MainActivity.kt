package io.github.qwadratic.nfctimesheets

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import io.github.qwadratic.nfctimesheets.nfc.NfcReadiness
import io.github.qwadratic.nfctimesheets.ui.TimeSheetApp
import io.github.qwadratic.nfctimesheets.ui.TimeSheetViewModel

/**
 * The one tap surface. Both dispatch paths converge here:
 *   - Android 16+  : ACTION_VIEW off the App Link, straight from the tag
 *   - Android <= 15: ACTION_NDEF_DISCOVERED, forwarded by NfcTapActivity
 *   - a human      : opening the same link from a browser or a message
 *
 * All three land in `handle`, which parses with the SAME TagLink and posts to the SAME
 * TapInbox, so a physical tap delivered twice collapses into one clock-in.
 */
class MainActivity : ComponentActivity() {

    private val app: TimeSheetsApplication get() = application as TimeSheetsApplication

    private val model: TimeSheetViewModel by lazy {
        ViewModelProvider(this, TimeSheetViewModel.Factory(app))[TimeSheetViewModel::class.java]
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // BEFORE the first composition: on a tap-launch the intent is already here while
        // the session is still Unknown, and TapInbox is what makes that survivable. This
        // ordering is the bug that lost the iOS owner's first real tap; it is pinned by
        // android/checks/core-check.kt.
        //
        // `savedInstanceState == null` IS NOT A TIDINESS CHECK — IT IS A SHIFT (TASK-225).
        // A non-null bundle means Android is REBUILDING an activity that already existed,
        // and `getIntent()` then returns the intent that started it however long ago. On a
        // phone where the OEM killed the process in a coat pocket — the premise of the
        // whole background-push feature — that intent is the morning's tag. Re-handling it
        // is a second tap at the same door, which is a CLOCK-OUT. Measured on a device
        // before this line existed: tap in, `am kill`, reopen — and `end_time` was set,
        // thirteen seconds after `start_time`. A genuine tap always reaches a FRESH
        // instance (null) or `onNewIntent`, so nothing real is dropped here.
        if (savedInstanceState == null) handle(intent)

        model.restoreSession()

        setContent {
            TimeSheetApp(
                model = model,
                nfcReadiness = { NfcReadiness.of(this) },
                openIntent = { startActivity(it) },
            )
        }
    }

    /** singleTask: a tap while the app is open reuses this instance instead of stacking. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    /**
     * Anything that is not a well-formed tag link for THIS build's host is dropped on the
     * floor. The tag is unlocked and its contents are untrusted (decision-15).
     */
    private fun handle(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return

        // THE RECENTS SCREEN IS NOT A TAG (TASK-225). Bringing a task back from history
        // re-delivers the intent that originally started it, and the platform flags it as
        // such precisely so that callers do not act on it twice. Without this, a worker
        // who taps in at the door, pockets the phone, has the app killed by the battery
        // manager, and later opens it from Recents to check their hours is CLOCKED OUT by
        // the act of looking — and the app has no button that closes a shift, so nobody
        // would ever think to look for a button as the cause.
        //
        // Reproduced on a device: `am start -f 0x10100000 -n …/MainActivity` after an
        // `am kill` set `end_time` every time. `demo/prove-offline-push.mjs` § 8 keeps it
        // reproduced, and checks that a REAL second tap still closes the shift — a guard
        // that also swallowed the clock-out would be a worse bug than the one it fixed.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return

        val locationId = app.tagLink.locationId(intent.dataString) ?: return
        model.acceptTap(locationId)
    }
}
