@file:JvmName("VersionTapGateCheck")

package io.github.qwadratic.nfctimesheets.checks

import io.github.qwadratic.nfctimesheets.core.VersionTapGate
import java.io.File

fun main() {
    val app = File("app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetApp.kt").readText()
    check(!app.contains("R.string.signin_operator_heading")) { "signed-out screen still shows the old operator row" }
    check(Regex("R\\.string\\.app_version_line").findAll(app).count() == 2) {
        "the version line must stay visible in signed-out and Settings screens"
    }
    check(app.split("VersionTapGate.advance(versionTapCount)").size - 1 == 2) {
        "signed-out and signed-in version rows must both drive the five-tap gate"
    }
    check(!app.contains("RowLink(stringResource(R.string.settings_operator_open), onOperator)")) {
        "ordinary worker Settings must not expose a direct operator row"
    }

    var tapCount = 0
    repeat(VersionTapGate.REQUIRED_TAPS - 1) { index ->
        val result = VersionTapGate.advance(tapCount)
        check(!result.openOperator) { "version tap ${index + 1} opened the operator screen early" }
        tapCount = result.tapCount
    }

    val fifth = VersionTapGate.advance(tapCount)
    check(fifth.openOperator) { "the fifth version tap did not open the operator screen" }
    check(fifth.tapCount == 0) { "the fifth version tap did not reset the counter" }

    val nextSequence = VersionTapGate.advance(fifth.tapCount)
    check(!nextSequence.openOperator && nextSequence.tapCount == 1) { "the next sequence did not start at one" }

    println("version-tap-gate-check: OK")
}
