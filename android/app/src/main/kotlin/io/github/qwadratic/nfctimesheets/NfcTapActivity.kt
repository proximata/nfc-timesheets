package io.github.qwadratic.nfctimesheets

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.nfc.NdefMessage
import android.nfc.NfcAdapter
import android.os.Build
import android.os.Bundle
import android.os.Parcelable

/**
 * The Android <= 15 tag path, and nothing else.
 *
 * On Android 16+ a tag holding an https URI fires ACTION_VIEW and goes straight to
 * MainActivity's App Link filter. On Android <= 15 the same tag fires
 * ACTION_NDEF_DISCOVERED, which App Links never see. This activity exists only to catch
 * that, and to forward the SAME URI into the SAME code path so there is one parser, one
 * TapInbox and one dedupe window.
 *
 * WHY A SEPARATE ACTIVITY: Android 17 (API 37) will require an NFC-dispatched activity to
 * be protected by android.permission.DISPATCH_NFC_MESSAGE. `android:permission` restricts
 * who may START an activity — on MainActivity it would stop the launcher and the browser.
 * It can only go on an activity that nothing but the NFC service starts. See the manifest.
 *
 * No UI, no theme, no lifecycle: Theme.NoDisplay + finish() in onCreate.
 */
class NfcTapActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val uri = tagUri(intent)
        if (uri != null) {
            // Re-enter through the normal front door rather than reaching into a
            // ViewModel that may not exist: on a cold tap MainActivity is not running,
            // and singleTask means a running one gets this in onNewIntent.
            startActivity(
                Intent(Intent.ACTION_VIEW, uri, this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        // A tag that carries something else is dropped silently and on purpose: tags are
        // unlocked (decision-15) and the parser in MainActivity is the only thing allowed
        // to decide what is one of ours.
        finish()
    }

    /**
     * First URI record in the NDEF message. `NfcAdapter.EXTRA_NDEF_MESSAGES` is the raw
     * payload from an attacker-writable tag, so nothing here trusts its shape.
     */
    private fun tagUri(intent: Intent?): Uri? {
        if (intent?.action != NfcAdapter.ACTION_NDEF_DISCOVERED) return null

        // The dispatch also puts the resolved URI straight on the intent for URI records.
        intent.data?.let { return it }

        val raw: Array<out Parcelable>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES, Parcelable::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES)
        }

        return raw.orEmpty()
            .filterIsInstance<NdefMessage>()
            .flatMap { it.records.asList() }
            .firstNotNullOfOrNull { record -> runCatching { record.toUri() }.getOrNull() }
    }
}
