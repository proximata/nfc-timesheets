package io.github.qwadratic.nfctimesheets.core

/**
 * The hand-off between "Android opened an App Link off a tag" and "the log screen wrote
 * a row". Port of NFCTimeSheets/NFCTimeSheets/TapInbox.swift, including the reason it
 * exists — the cold-launch ordering below is the exact thing that lost the owner's first
 * real tap on iOS, and it is not going to be re-discovered here.
 *
 * A tap can arrive from three places and all of them land in this one mailbox:
 *   - Android 16+  : ACTION_VIEW App Link, delivered to MainActivity.onCreate/onNewIntent
 *   - Android <=15 : ACTION_NDEF_DISCOVERED, delivered to NfcTapActivity, forwarded here
 *   - the user     : opening the link from a browser or a message
 *
 * COLD LAUNCH ORDERING — the reason this is a mailbox and not a callback.
 * `onCreate` sees the intent while the session is still being restored from the server,
 * so on a tap-launch the tap arrives BEFORE any screen that could act on it exists.
 * Two orderings have to work:
 *
 *   set-before-consumer: accept() parks the id while the UI is still a spinner. The log
 *     screen appears later and takes it -> handled once.
 *   set-after-consumer: the screen is already up and observing; accept() flips pending
 *     null -> X, the observer takes X -> handled once.
 *
 * In both orderings take() then flips X -> null; a consumer that guards on non-null
 * drops that echo. So: never lost, never twice.
 *
 * Not a StateFlow and not Android-aware, so android/checks can run the orderings.
 */
class TapInbox(private val nowMillis: () -> Long = System::currentTimeMillis) {

    var pendingLocationId: String? = null
        private set

    private var lastLocationId: String? = null
    private var lastAtMillis: Long = 0

    /**
     * One physical tap can be delivered twice (the NDEF dispatch AND the App Link), so
     * identical taps inside a short window collapse into one. Without this, one tap
     * would clock in and straight back out.
     */
    fun accept(locationId: String): Boolean {
        val now = nowMillis()
        if (locationId == lastLocationId && now - lastAtMillis < WINDOW_MS) return false
        lastLocationId = locationId
        lastAtMillis = now
        pendingLocationId = locationId
        return true
    }

    fun take(): String? {
        val id = pendingLocationId
        pendingLocationId = null
        return id
    }

    private companion object {
        const val WINDOW_MS = 3_000L
    }
}
