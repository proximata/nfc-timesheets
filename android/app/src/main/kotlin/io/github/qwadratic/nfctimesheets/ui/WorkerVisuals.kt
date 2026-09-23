package io.github.qwadratic.nfctimesheets.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.core.view.WindowCompat
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp

/** Worker surfaces share one geometry; semantic warning colours still belong to callers. */
@Composable
internal fun WorkerCard(
    modifier: Modifier = Modifier,
    colors: CardColors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    border: BorderStroke? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(modifier, shape = RoundedCornerShape(18.dp), colors = colors, border = border, content = content)
}

internal enum class WorkerPicture { ENTRANCE, SUPPLIES }

/** Small vector scenes, drawn locally with theme roles and excluded from TalkBack.
 * Instructions remain real text. No network images or continuously running idle animation. */
@Composable
internal fun WorkerIllustration(picture: WorkerPicture, modifier: Modifier = Modifier) {
    val ink = MaterialTheme.colorScheme.onSurface
    val soft = MaterialTheme.colorScheme.surfaceContainerHigh
    val paper = MaterialTheme.colorScheme.surfaceContainerLow
    val accent = MaterialTheme.colorScheme.primary
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(modifier.fillMaxWidth().height(100.dp).clearAndSetSemantics { }) {
        val unit = minOf(size.width / 230f, size.height / 112f)
        scale(unit, unit, pivot = Offset.Zero) {
            val left = (size.width / unit - 230f) / 2
            fun point(x: Float, y: Float) = Offset(left + x, y)
            fun round(x: Float, y: Float, w: Float, h: Float, color: androidx.compose.ui.graphics.Color, r: Float = 8f) =
                drawRoundRect(color, point(x, y), Size(w, h), CornerRadius(r))
            drawOval(soft, point(12f, 18f), Size(206f, 86f))
            when (picture) {
                WorkerPicture.ENTRANCE -> {
                    round(78f, 7f, 79f, 94f, paper, 12f)
                    round(89f, 17f, 49f, 84f, ink, 6f)
                    round(95f, 24f, 37f, 70f, soft, 3f)
                    drawCircle(ink, 2f, point(126f, 61f))
                    round(146f, 39f, 19f, 25f, ink, 5f)
                    drawArc(paper, -60f, 120f, false, point(145f, 45f), Size(12f, 13f), style = Stroke(1.8f))
                    drawArc(paper, -60f, 120f, false, point(145f, 48f), Size(7f, 7f), style = Stroke(1.8f))
                    round(177f, 42f, 31f, 55f, ink, 7f)
                    round(181f, 48f, 23f, 39f, paper, 3f)
                    drawLine(paper, point(187f, 92f), point(198f, 92f), 2f, StrokeCap.Round)
                    drawLine(muted, point(170f, 50f), point(176f, 46f), 2f, StrokeCap.Round)
                    drawLine(muted, point(171f, 58f), point(177f, 60f), 2f, StrokeCap.Round)
                    round(33f, 76f, 27f, 25f, muted, 5f)
                    drawLine(muted, point(45f, 78f), point(45f, 44f), 3f, StrokeCap.Round)
                    drawOval(accent, point(25f, 44f), Size(22f, 11f))
                    drawOval(accent, point(44f, 55f), Size(20f, 11f))
                }
                WorkerPicture.SUPPLIES -> {
                    round(66f, 58f, 104f, 44f, ink, 12f)
                    round(87f, 31f, 27f, 53f, accent, 6f)
                    round(94f, 22f, 13f, 13f, ink, 3f)
                    drawLine(ink, point(99f, 22f), point(117f, 22f), 5f, StrokeCap.Round)
                    round(91f, 50f, 19f, 19f, paper, 3f)
                    round(127f, 43f, 22f, 41f, paper, 5f)
                    drawLine(muted, point(137f, 44f), point(155f, 15f), 5f, StrokeCap.Round)
                    drawLine(ink, point(86f, 62f), point(86f, 44f), 3f, StrokeCap.Round)
                    drawLine(ink, point(86f, 44f), point(152f, 44f), 3f, StrokeCap.Round)
                    drawLine(ink, point(152f, 44f), point(152f, 62f), 3f, StrokeCap.Round)
                    drawLine(paper, point(106f, 80f), point(132f, 80f), 3f, StrokeCap.Round)
                }

            }
        }
    }
}

/** The fixed blue shift field needs light status icons even when the OS uses light mode. */
@Composable
internal fun WorkerStatusBar(field: Color) {
    val window = LocalContext.current.activity()?.window ?: return
    val systemDark = isSystemInDarkTheme()
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    DisposableEffect(window, systemDark) {
        onDispose { controller.isAppearanceLightStatusBars = !systemDark }
    }
    SideEffect { controller.isAppearanceLightStatusBars = field.luminance() > .5f }
}
