package io.github.qwadratic.nfctimesheets.nfc

import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.os.Build
import android.provider.Settings

/**
 * Every way NFC clocking can be silently switched off, and what to do about each.
 *
 * NOT POLISH. A worker holds the phone to the tag, nothing happens, and they go and clean
 * for four hours believing they clocked in. That is the worst bug this product can have,
 * and on Android there are three separate ways to get there that iOS does not have.
 */
enum class NfcReadiness {
    /** Good to go. */
    READY,

    /** No NFC hardware. Nothing the app can do; the worker needs a different phone. */
    UNSUPPORTED,

    /** NFC is off in system settings. One tap to fix, and [nfcSettingsIntent] opens it. */
    DISABLED,

    /**
     * TRAP 1 — Android 16 (API 36) tag-intent allowlist.
     *
     * "Starting Android 16, users are notified when an app receives its first NFC intent
     * to scan NFC tags. The user is provided with the option to disallow the app from
     * scanning for NFC tags anymore in the notification."
     *
     * WHERE IT BITES: the notification arrives at the worst possible moment — the FIRST
     * tap, at a door — and dismissing it wrong permanently stops tag dispatch to this app
     * with no other symptom. So it is checked on every launch, not once at onboarding,
     * and [changeTagIntentPreferenceIntent] re-opens the choice.
     */
    TAG_INTENTS_BLOCKED,
    ;

    companion object {
        /** Android 16. `Build.VERSION_CODES.BAKLAVA`, written as a literal so this file
         *  keeps compiling if compileSdk is rolled back. */
        private const val ANDROID_16 = 36

        fun of(context: Context): NfcReadiness {
            val adapter = NfcAdapter.getDefaultAdapter(context) ?: return UNSUPPORTED
            if (!adapter.isEnabled) return DISABLED
            if (Build.VERSION.SDK_INT >= ANDROID_16 && !adapter.isTagIntentAllowed) return TAG_INTENTS_BLOCKED
            return READY
        }

        fun nfcSettingsIntent(): Intent = Intent(Settings.ACTION_NFC_SETTINGS)

        /** Android 16+. Re-opens the "Launch via NFC" choice the worker dismissed. */
        fun changeTagIntentPreferenceIntent(): Intent =
            Intent(NfcAdapter.ACTION_CHANGE_TAG_INTENT_PREFERENCE)
    }
}

/*
 * TRAP 2 — stopped state, Android 17+ (API 37).
 *
 *   "the system will not dispatch NFC intents to applications that are in a stopped state
 *   (e.g. if the application has never been launched by the user or has been force-stopped)."
 *
 * WHERE IT BITES: install from Play, hand the phone to a worker, they walk to the door and
 * tap. Nothing happens, for ever, because the app has never been opened. There is NO API
 * that fixes this from inside the app — by definition the app is not running to call it.
 * It is a ROLLOUT step, so it lives in three places and nowhere else can help:
 *   - android/README.md, in the worker rollout checklist
 *   - R.string.nfc_first_run_note, shown on the sign-in screen
 *   - here, so the next reader does not go looking for the API call
 * OEM battery managers (Samsung, Xiaomi, Huawei) can force-stop the app back INTO this
 * state days later. Unproven until it happens on a real device in a real pocket.
 *
 * TRAP 3 — DISPATCH_NFC_MESSAGE, Android 17+ (API 37).
 *
 *   "for an activity to be dispatched an NFC intent, if the app targets SDK >
 *   Build.VERSION_CODES.BAKLAVA, it must be protected by the
 *   android.permission.DISPATCH_NFC_MESSAGE permission."
 *
 * WHERE IT BITES: AndroidManifest.xml, on NfcTapActivity, and ONLY when targetSdk moves
 * past 36. The exact one-line change and why it must not be applied now is written there.
 */
