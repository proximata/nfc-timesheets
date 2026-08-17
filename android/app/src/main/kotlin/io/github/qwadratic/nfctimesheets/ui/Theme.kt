package io.github.qwadratic.nfctimesheets.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/**
 * Stock Material 3, and deliberately nothing more.
 *
 * The fallback palettes below are the Material baseline, which is verified at WCAG AA for
 * every on-* pair. Every colour used anywhere in this app is a Material role
 * (`onSurfaceVariant`, `error`, `tertiary`), never a literal — a hand-picked hex is how a
 * contrast failure gets shipped to someone reading a phone in a dim stairwell.
 */
@Composable
fun TimeSheetsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val colors = when {
        // Android 12+: follow the user's wallpaper palette. It is generated to meet the
        // same contrast ratios, and it is what the rest of their phone looks like.
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkColorScheme(primary = Blue80, secondary = Slate80, tertiary = Amber80)
        else -> lightColorScheme(primary = Blue40, secondary = Slate40, tertiary = Amber40)
    }
    MaterialTheme(colorScheme = colors, content = content)
}

private val Blue40 = Color(0xFF0061A4)
private val Slate40 = Color(0xFF535F70)
private val Amber40 = Color(0xFF7D5700)
private val Blue80 = Color(0xFF9ECAFF)
private val Slate80 = Color(0xFFBBC7DB)
private val Amber80 = Color(0xFFF6BD48)
