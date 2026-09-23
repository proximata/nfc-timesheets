package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import io.github.qwadratic.nfctimesheets.core.ShiftSignal

/** Decorative navigation icons; the translated label supplies the accessible name. */
@Composable
fun WorkerNavIcon(tab: ShiftSignal.Tab) {
    val color = LocalContentColor.current
    Canvas(Modifier.size(24.dp)) {
        val unit = size.width / 24
        when (tab) {
            ShiftSignal.Tab.LOG, ShiftSignal.Tab.HISTORY -> {
                drawCircle(color, 9 * unit, style = Stroke(2 * unit))
                drawLine(color, center, Offset(12 * unit, 6 * unit), 2 * unit)
                drawLine(color, center, Offset(17 * unit, 14 * unit), 2 * unit)
            }
            ShiftSignal.Tab.MATERIALS -> {
                drawRect(color, Offset(3 * unit, 5 * unit), Size(18 * unit, 15 * unit), style = Stroke(2 * unit))
                drawLine(color, Offset(3 * unit, 10 * unit), Offset(21 * unit, 10 * unit), 2 * unit)
                drawLine(color, Offset(12 * unit, 5 * unit), Offset(12 * unit, 10 * unit), 2 * unit)
            }
            ShiftSignal.Tab.SETTINGS -> listOf(5, 12, 19).forEach {
                drawCircle(color, 2 * unit, Offset(it * unit, 12 * unit))
            }
        }
    }
}
