@file:JvmName("KnownTagsCheck")

package io.github.qwadratic.nfctimesheets.checks

import io.github.qwadratic.nfctimesheets.core.TagLink
import io.github.qwadratic.nfctimesheets.core.Zones
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
 *
 * KnownTags.BY_SERIAL IS CURRENTLY EMPTY (decision-69). Its one entry was a HOIV building
 * serial mapped to that BUILDING's own uuid, removed alongside decision-47's HOIV grandfather
 * clause once the owner confirmed that physical card was never actually deployed. What is
 * still worth pinning against an empty table: every input, in every format, still resolves to
 * null (never a stale hit against dead table state), and the round trip / normalisation
 * mechanisms KnownTags is built on are correct independently of what the table currently
 * holds, so a future adopted tag can be added here with confidence.
 */
private var failures = 0
private fun check(name: String, actual: Any?, expected: Any?) {
    if (actual == expected) return
    println("  FAIL $name\n    expected: $expected\n    actual:   $actual")
    failures++
}
fun main() {
    // The TAG host, read from branding.properties rather than typed here (decision-40): a
    // check carrying its own copy of the host stops checking anything the day the host
    // moves, and this file's whole subject is a URL that has to survive that day.
    val host = java.util.Properties()
        .apply { java.io.File("branding.properties").inputStream().use { load(it) } }
        .getProperty("ts.tagHost").trim()
    val link = TagLink(host)
    // A fixture zone id, unrelated to KnownTags' table: the round trip below exercises
    // TagLink alone and has never needed a table entry to mean something.
    val zoneId = "9f2b6e1a-59b4-4b3a-9d0e-6a1c8b4f2e10"
    val serial = "04:A1:A8:52:AE:5C:80"
    // --- the mapping itself, against an EMPTY table ---------------------------------
    check("no serial resolves against an empty table", KnownTags.locationIdFor(serial), null)
    check("unknown serial is null", KnownTags.locationIdFor("04:00:00:00:00:00:00"), null)
    check("null serial is null", KnownTags.locationIdFor(null), null)
    check("blank serial is null", KnownTags.locationIdFor("   "), null)
    // Every casing or separator a reader might print must still reach the SAME lookup,
    // even though the answer is null today \u2014 that is what "the table is not consulted
    // before normalising" means, and it is the property a future adopted tag relies on.
    for (variant in listOf(
        "04:a1:a8:52:ae:5c:80",
        "04A1A852AE5C80",
        "04-A1-A8-52-AE-5C-80",
        "04 A1 A8 52 AE 5C 80",
    )) {
        check("normalised variant still resolves via the table ($variant)", KnownTags.locationIdFor(variant), null)
    }
    check("truncated", KnownTags.locationIdFor("04:A1:A8:52"), null)
    // --- the round trip, independent of KnownTags' table -----------------------------
    val synthesised = link.uriFor(zoneId)
    check("uriFor builds a URL", synthesised != null, true)
    check(
        "synthesised URL is exactly the tag format",
        synthesised.toString(),
        "https://$host/t?l=$zoneId",
    )
    // The permanent tag host (decision-40), not derived from branding: a check that reads
    // the value it is checking cannot fail. Move ts.tagHost and this goes red, which is
    // the point.
    check("the synthesised URL uses the permanent tag host", synthesised.toString(), "https://timesheets.exe.xyz/t?l=$zoneId")
    // THE ONE THAT MATTERS: what we synthesise, we must also accept.
    check("round trip parses back", link.locationId(synthesised.toString()), zoneId)
    // uriFor must refuse anything that is not a UUID, or a bad table entry becomes a URL.
    check("uriFor rejects non-uuid", link.uriFor("hoiv-arsenalstrasse-11"), null)
    check("uriFor rejects null", link.uriFor(null), null)
    check("uriFor rejects injection", link.uriFor("../../evil"), null)
    check("uriFor rejects lenient uuid", link.uriFor("1-1-1-1-1"), null)
    // A serial is not a URL and must never be treated as one.
    check("serial is not a tag link", link.locationId(serial), null)

    // --- KnownTags now DELEGATES its normalisation to core/Zones.kt (decision-44) ---
    // What used to be an inline `.uppercase().filter{...}.chunked(2).joinToString(":")`
    // in this file must still agree with itself, on this fixture serial, now that it
    // lives in one place instead of two.
    check("Zones.normaliseSerial(canonical)", Zones.normaliseSerial(serial), serial)
    check("Zones.normaliseSerial(lowercase)", Zones.normaliseSerial("04:a1:a8:52:ae:5c:80"), serial)
    check("Zones.normaliseSerial(no separators)", Zones.normaliseSerial("04A1A852AE5C80"), serial)
    check("Zones.normaliseSerial(dashes)", Zones.normaliseSerial("04-A1-A8-52-AE-5C-80"), serial)
    check("Zones.normaliseSerial(spaces)", Zones.normaliseSerial("04 A1 A8 52 AE 5C 80"), serial)
    check("Zones.normaliseSerial(one byte off) disagrees", Zones.normaliseSerial("04:A1:A8:52:AE:5C:81") == serial, false)

    if (failures == 0) println("known-tags-check: OK") else {
        println("known-tags-check: $failures FAILED")
        kotlin.system.exitProcess(1)
    }
}
