@file:JvmName("KnownTagsCheck")

package io.github.qwadratic.nfctimesheets.checks

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.nfc.KnownTags

/*
 * Adopted-tag mapping: serial -> location, and the URL synthesised from it.
 *
 * Run concatenated with core/KnownTags.kt and core/TagLink.kt (see checks/run.sh).
 *
 * The point of this check is the ROUND TRIP. An adopted tag has no URL, so one is
 * synthesised and then re-parsed by the same TagLink that guards every real tap. If those
 * two ever disagree, a scan produces a URL the app itself would refuse, and the worker gets
 * "unknown tag" while holding a tag that is in the table. That is the failure this pins.
 */
private var failures = 0
private fun check(name: String, actual: Any?, expected: Any?) {
    if (actual == expected) return
    println("  FAIL $name\n    expected: $expected\n    actual:   $actual")
    failures++
}
fun main() {
    val host = "timesheets.exe.xyz"
    val link = TagLink(host)
    val hoiv = "c3c37d4a-ca0a-42c5-b248-9704b9907ec7"
    val serial = "04:A1:A8:52:AE:5C:80"
    // --- the mapping itself -------------------------------------------------------
    check("known serial maps to HOIV", KnownTags.locationIdFor(serial), hoiv)
    check("unknown serial is null", KnownTags.locationIdFor("04:00:00:00:00:00:00"), null)
    check("null serial is null", KnownTags.locationIdFor(null), null)
    check("blank serial is null", KnownTags.locationIdFor("   "), null)
    // Any casing or separator a reader might print. A serial that fails to normalise is a
    // worker standing at a tag that does nothing.
    check("lowercase", KnownTags.locationIdFor("04:a1:a8:52:ae:5c:80"), hoiv)
    check("no separators", KnownTags.locationIdFor("04A1A852AE5C80"), hoiv)
    check("dashes", KnownTags.locationIdFor("04-A1-A8-52-AE-5C-80"), hoiv)
    check("spaces", KnownTags.locationIdFor("04 A1 A8 52 AE 5C 80"), hoiv)
    // A near-miss must NOT match: one byte different is a different tag, in a different
    // building, and a lenient match here would book a shift at the wrong address.
    check("one byte off", KnownTags.locationIdFor("04:A1:A8:52:AE:5C:81"), null)
    check("truncated", KnownTags.locationIdFor("04:A1:A8:52"), null)
    // --- the round trip -----------------------------------------------------------
    val synthesised = link.uriFor(hoiv)
    check("uriFor builds a URL", synthesised != null, true)
    check(
        "synthesised URL is exactly the tag format",
        synthesised.toString(),
        "https://timesheets.exe.xyz/t?l=$hoiv",
    )
    // THE ONE THAT MATTERS: what we synthesise, we must also accept.
    check("round trip parses back", link.locationId(synthesised.toString()), hoiv)
    // uriFor must refuse anything that is not a UUID, or a bad table entry becomes a URL.
    check("uriFor rejects non-uuid", link.uriFor("hoiv-arsenalstrasse-11"), null)
    check("uriFor rejects null", link.uriFor(null), null)
    check("uriFor rejects injection", link.uriFor("../../evil"), null)
    check("uriFor rejects lenient uuid", link.uriFor("1-1-1-1-1"), null)
    // A serial is not a URL and must never be treated as one.
    check("serial is not a tag link", link.locationId(serial), null)
    if (failures == 0) println("known-tags-check: OK") else {
        println("known-tags-check: $failures FAILED")
        kotlin.system.exitProcess(1)
    }
}
