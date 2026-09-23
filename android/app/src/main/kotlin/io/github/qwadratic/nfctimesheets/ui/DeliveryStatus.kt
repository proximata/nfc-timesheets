package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.github.qwadratic.nfctimesheets.R
import io.github.qwadratic.nfctimesheets.core.PendingWork
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import io.github.qwadratic.nfctimesheets.AppLanguage
import androidx.compose.ui.platform.LocalContext

/** Delivery is persistent information. Only its diagnostics collapse; the count never does. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DeliveryStatus(
    pending: PendingWork.Summary,
    signedOut: Boolean = false,
    armed: Boolean = true,
    ink: Color = MaterialTheme.colorScheme.onSurface,
) {
    if (pending.isEmpty) return
    var details by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        if (pending.blocked > 0) DeliveryRow(
            pluralStringResource(R.plurals.delivery_blocked_short, pending.blocked, pending.blocked), true, ink,
        ) { details = true }
        if (pending.waiting > 0) DeliveryRow(
            pluralStringResource(R.plurals.delivery_waiting_short, pending.waiting, pending.waiting), false, ink,
        ) { details = true }
    }
    if (details) {
        val locale = AppLanguage.locale(LocalContext.current)
        val format = remember(locale) {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(locale).withZone(ZoneId.systemDefault())
        }
        ModalBottomSheet(onDismissRequest = { details = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(stringResource(R.string.delivery_title), style = MaterialTheme.typography.headlineSmall)
                if (pending.blocked > 0) {
                    Text(pluralStringResource(R.plurals.delivery_blocked_short, pending.blocked, pending.blocked),
                        style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
                    Text(stringResource(R.string.delivery_blocked_detail), style = MaterialTheme.typography.bodyMedium)
                }
                if (pending.waiting > 0) {
                    Text(pluralStringResource(R.plurals.delivery_waiting_short, pending.waiting, pending.waiting),
                        style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(when {
                        signedOut -> R.string.delivery_sign_in
                        !armed -> R.string.delivery_not_scheduled
                        else -> R.string.delivery_automatic
                    }), style = MaterialTheme.typography.bodyMedium)
                    Text(stringResource(R.string.pending_force_stop_note), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
                pending.oldestStart?.let { Text(stringResource(R.string.pending_oldest, format.format(it)), style = MaterialTheme.typography.bodySmall) }
                Text(pending.lastAttemptAt?.let { stringResource(R.string.pending_last_try, format.format(it)) }
                    ?: stringResource(R.string.delivery_no_attempt), style = MaterialTheme.typography.bodySmall)
                Button(onClick = { details = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Text(stringResource(R.string.dismiss))
                }
            }
        }
    }
}

@Composable
private fun DeliveryRow(label: String, blocked: Boolean, ink: Color, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).heightIn(min = 56.dp).padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Canvas(Modifier.size(20.dp)) {
            val stroke = 1.6.dp.toPx()
            drawCircle(ink, size.width * .4f, style = Stroke(stroke))
            if (blocked) {
                drawLine(ink, Offset(center.x, size.height*.27f), Offset(center.x, size.height*.53f), stroke, StrokeCap.Round)
                drawCircle(ink, stroke*.6f, Offset(center.x, size.height*.7f))
            } else {
                drawLine(ink, center, Offset(center.x,size.height*.27f),stroke,StrokeCap.Round)
                drawLine(ink, center, Offset(size.width*.67f,center.y),stroke,StrokeCap.Round)
            }
        }
        Text(label, color = ink, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Canvas(Modifier.size(16.dp)) {
            drawLine(ink, Offset(size.width*.4f,size.height*.25f), Offset(size.width*.65f,size.height*.5f),1.5.dp.toPx(),StrokeCap.Round)
            drawLine(ink, Offset(size.width*.65f,size.height*.5f), Offset(size.width*.4f,size.height*.75f),1.5.dp.toPx(),StrokeCap.Round)
        }
    }
}
