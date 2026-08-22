package io.github.qwadratic.nfctimesheets.nfc

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.WireOperatorZone

/**
 * DEBUG BUILDS ONLY. There is a file with this exact name and package in `src/release/`
 * whose [verifyTapSimulations] returns an empty list and contains none of the scenarios
 * below — same split as `nfc/WriteSimulation.kt`, checked the same way against the compiled
 * dex, not the source: `android/checks/release-artefact.sh`.
 *
 * WHY THIS EXISTS. NFC hardware does not work on an emulator: there is no field, no card,
 * and `enableReaderMode` never fires. [VerifyZoneActivity]'s outcome rendering — a match, a
 * mismatch, the grandfathered building card, an unreadable card — would otherwise be
 * unexercisable anywhere except a client's building with a client's cards.
 *
 * A MUCH SHALLOWER MOCK THAN [WriteSimulation], and deliberately so. Writing a tag has to
 * fake actual NDEF bytes and a platform decode, because `TagWriter` genuinely round-trips
 * them. Verifying one does not: past the point where a tag is read, all this screen ever
 * has is a URI string and a UID string (see [VerifyZoneActivity.handleRead]), so a
 * simulation only has to supply THOSE — the real resolution logic and the real network call
 * to `POST /operator/zones/:id/verify` run exactly as they would for a genuine tap. It
 * simulates the tag, not the answer.
 *
 * NEVER A NETWORK-FAILURE SCENARIO HERE. A transport failure is not a fact about a TAG, and
 * faking one would mean the debug build's outcome rendering for it is proven against a
 * canned exception rather than the real `java.net.HttpURLConnection` path every other
 * failure in this file goes through. Exercise it by disconnecting the emulator's network
 * instead — the real transport, no mock required.
 */
data class VerifyTapSimulation(
    val label: String,
    val techs: List<String>,
    val uid: String,
    /** What `readUri()` would have returned, already stringified. null = no NDEF URI. */
    val uriString: String?,
)

/**
 * The building in production. A card carrying this id is the one grandfathered by
 * decision-47 — it must MISMATCH here (a building has no zone to verify), the same way it
 * must resolve at all on a cleaner's tap.
 */
private const val HOIV_LOCATION = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"

fun verifyTapSimulations(
    selected: WireOperatorZone,
    all: List<WireOperatorZone>,
    tagLink: TagLink,
): List<VerifyTapSimulation> {
    val scenarios = mutableListOf(
        VerifyTapSimulation(
            label = "SIMULATED: die Karte dieser Zone \u2014 sollte freischalten",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D0",
            uriString = tagLink.uriFor(selected.id)?.toString(),
        ),
        VerifyTapSimulation(
            label = "SIMULATED: die HOIV-Gebaeude-Karte (kein Zonen-Tag) \u2014 sollte NICHT passen",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D1",
            uriString = tagLink.uriFor(HOIV_LOCATION)?.toString(),
        ),
        VerifyTapSimulation(
            label = "SIMULATED: eine leere oder unlesbare Karte",
            techs = listOf("SIMULATED"),
            uid = "SI:MU:LA:TE:D2",
            uriString = null,
        ),
    )
    // Only offered when a second zone actually exists to borrow a card from.
    all.firstOrNull { it.id != selected.id }?.let { other ->
        scenarios.add(
            1,
            VerifyTapSimulation(
                label = "SIMULATED: die Karte der Zone \u201e${other.name}\u201c \u2014 sollte NICHT passen",
                techs = listOf("SIMULATED"),
                uid = "SI:MU:LA:TE:D3",
                uriString = tagLink.uriFor(other.id)?.toString(),
            ),
        )
    }
    return scenarios
}
