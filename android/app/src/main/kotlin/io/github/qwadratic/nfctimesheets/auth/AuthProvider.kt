package io.github.qwadratic.nfctimesheets.auth

import io.github.qwadratic.nfctimesheets.core.ApiFailure

/**
 * THE SIGN-IN SEAM.
 *
 * Worker identity on Android is decision-26 and it is **proposed, not accepted**. The
 * plan costed three options (Sign in with Apple's web flow, adding Google, an
 * admin-issued one-time enrolment code) and the choice is the owner's. It is not a build
 * agent's, and it is not made here.
 *
 * So this interface is the seam and nothing is behind it yet. What matters is that
 * everything AROUND it is identical under all three options:
 *
 *   - the credential is exchanged for a `ts_worker` cookie by ONE POST to the server
 *   - GET /auth/session is what says who you are, on every launch
 *   - a 401 anywhere drops the app to signed-out
 *   - POST /auth/logout revokes server-side
 *
 * Whichever option wins adds ONE implementation of this interface and ONE call in the
 * sign-in screen. Nothing else in the app changes.
 *
 * decision-22 is satisfied by construction: `signIn` returns nothing. It puts a cookie in
 * the jar (via the server's Set-Cookie) and the app then ASKS the server who that is.
 * There is no path by which this app names a worker.
 */
interface AuthProvider {
    /**
     * Obtain a worker session. Throws [ApiFailure] on refusal — 403 not_eligible carries
     * the address the provider handed the server, which the dead-end screen displays.
     */
    suspend fun signIn()

    /** False when this build has no working sign-in. The UI must say so, not hide it. */
    val isConfigured: Boolean
}

/**
 * The default, and the only implementation that ships until decision-26 is accepted.
 *
 * FAILS HONESTLY AND VISIBLY. An unauthenticated build must not look like it works: a
 * worker who taps a tag and sees a friendly screen, while nothing is ever filed, is the
 * worst outcome this product has — it is unpaid work that nobody notices for a month.
 * So there is no button, no retry, no offline "we'll sync later"; the sign-in screen
 * states that no sign-in method has been configured and stops.
 */
object UnconfiguredAuthProvider : AuthProvider {
    override val isConfigured: Boolean = false

    override suspend fun signIn(): Nothing =
        throw ApiFailure(status = 0, code = "sign_in_unconfigured")
}
