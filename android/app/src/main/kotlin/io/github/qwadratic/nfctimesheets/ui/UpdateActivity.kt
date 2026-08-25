package io.github.qwadratic.nfctimesheets.ui

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import io.github.qwadratic.nfctimesheets.AppLocale
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.TimeSheetsApplication

/**
 * THE UPDATE SCREEN FOR A PHONE THAT NEVER SIGNS IN AS A WORKER (TASK-254).
 *
 * An operator-only phone (Mister Clarity, op id 71) never reaches Settings, because
 * Settings lives behind a worker session. Before this screen existed it had no
 * self-service path to a fix at all — 0.5.6 -> 0.5.7 shipped an operator-reachability
 * fix that such a phone could only have received by hand.
 *
 * IT IS ITS OWN ACTIVITY, ON PURPOSE, and not the section pasted into
 * WriteTagActivity/VerifyZoneActivity: [UpdateSection] needs [TimeSheetViewModel], and
 * handing that view model to the verify screen would hand it `acceptTap` and the whole
 * worker-session machinery — the exact wiring checks/verify-no-shift-check.sh exists to
 * forbid. Those two screens gain a `startActivity` and nothing else; their network
 * surface is unchanged.
 *
 * IT NEVER BOOTSTRAPS A WORKER SESSION -- deliberately, and checks/update-reach-check.sh
 * fails if the call that would do so ever appears here. This screen is identity-agnostic:
 * the one route it drives, GET /app/version, is auth:"app" and needs no session at all.
 */
class UpdateActivity : ComponentActivity() {

    private val app: TimeSheetsApplication get() = application as TimeSheetsApplication

    private val model: TimeSheetViewModel by lazy {
        ViewModelProvider(this, TimeSheetViewModel.Factory(app))[TimeSheetViewModel::class.java]
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TimeSheetsTheme {
                Scaffold { padding ->
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding)
                            .padding(24.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        // shiftRunning = false: this host does not know whether a shift is
                        // running and deliberately will not ask. A fresh view model's log is
                        // empty, so reading `.open` off it would report "no shift" as a FACT
                        // when it is only an absence of data. The flag gates one reassuring
                        // sentence; omitting a reassurance is not the same as stating a
                        // falsehood. ponytail: CEILING — if that sentence is wanted here,
                        // read the open shift straight off ShiftStore in a LaunchedEffect.
                        // UPGRADE: that read, not a second view-model bootstrap.
                        UpdateSection(model, shiftRunning = false, openIntent = { startActivity(it) })
                        Button(
                            onClick = { finish() },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.scan_close)) }
                    }
                }
            }
        }
    }
}
