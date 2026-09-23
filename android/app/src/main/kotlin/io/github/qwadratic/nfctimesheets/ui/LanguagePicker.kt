package io.github.qwadratic.nfctimesheets.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Surface
import androidx.compose.animation.animateColorAsState
import androidx.compose.runtime.getValue
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.qwadratic.nfctimesheets.AppLanguage
import io.github.qwadratic.nfctimesheets.R

@Composable
fun LanguagePicker() {
    val context = LocalContext.current
    val current = AppLanguage.selected(context)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.language_title), style = MaterialTheme.typography.labelLarge)
        Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(16.dp)) {
        Row(Modifier.fillMaxWidth().padding(4.dp).height(IntrinsicSize.Min).selectableGroup()) {
            listOf("de" to R.string.language_de, "en" to R.string.language_en, "" to R.string.language_system)
                .forEach { (language, label) ->
                    val active = current == language
                    val background by animateColorAsState(
                        if (active) MaterialTheme.colorScheme.inverseSurface else MaterialTheme.colorScheme.surfaceContainerHigh,
                        label = "language selection",
                    )
                    Surface(color = background, shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f).fillMaxHeight()) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.selectable(selected = active, role = Role.RadioButton,
                                onClick = { context.activity()?.let { AppLanguage.set(it, language) } })
                                .heightIn(min = 48.dp).padding(horizontal = 4.dp, vertical = 14.dp),
                        ) {
                        Text(
                            stringResource(label),
                            color = if (active) MaterialTheme.colorScheme.inverseOnSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.labelLarge,
                            textAlign = TextAlign.Center,
                        )
                        }
                    }
                }
        }
        }
    }
}

internal fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}
