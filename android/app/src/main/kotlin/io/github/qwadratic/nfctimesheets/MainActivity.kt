package io.github.qwadratic.nfctimesheets

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // BEFORE the first composition: on a tap-launch the intent is already here while
        // the session is still Unknown, and TapInbox is what makes that survivable. This
        // ordering is the bug that lost the iOS owner's first real tap; it is pinned by
        // android/checks/core-check.kt.
        handle(intent)

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
        val locationId = app.tagLink.locationId(intent.dataString) ?: return
        model.acceptTap(locationId)
    }
}
