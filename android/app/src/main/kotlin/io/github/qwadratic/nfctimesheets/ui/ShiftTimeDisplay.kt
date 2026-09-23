package io.github.qwadratic.nfctimesheets.ui

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.qwadratic.nfctimesheets.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant

/** Cosmetic receipt memory, independent of shift persistence. Old/restored shifts do not replay.
 * Record consumption before animating, including when Android has disabled animations. */
@Composable
internal fun confirmationProgress(identity: String, confirmed: Boolean, eventTime: Instant, kind: String): Float {
    val preferences = LocalContext.current.getSharedPreferences("worker-motion", Context.MODE_PRIVATE)
    val progress = remember(identity) { Animatable(1f) }
    LaunchedEffect(identity, confirmed) {
        if (!confirmed) {
            progress.snapTo(1f)
            return@LaunchedEffect
        }
        if (preferences.getString(kind, null) == identity) return@LaunchedEffect
        val age = Duration.between(eventTime, Instant.now()).seconds
        val saved = withContext(Dispatchers.IO) { preferences.edit().putString(kind, identity).commit() }
        if (saved && age in 0..45) {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(900, easing = LinearEasing))
        }
    }
    return progress.value
}

/** The transient ring resolves into a check; it is never an indeterminate network spinner.
 * The time and its accessibility label exist throughout. No business action uses this clock. */
@Composable
internal fun ShiftTimeDisplay(value: String, identity: String, confirmed: Boolean, eventTime: Instant, ink: Color) {
    val progress = confirmationProgress(identity, confirmed, eventTime, "clock-in")
    Box(Modifier.fillMaxWidth().heightIn(min = 176.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth().graphicsLayer {
            alpha = if (progress >= 1f) 1f else ((progress - .80f) / .20f).coerceIn(0f, 1f)
            translationY = (1f - alpha) * 12.dp.toPx()
        }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.worker_elapsed), color = ink.copy(alpha = .8f),
                style = MaterialTheme.typography.labelMedium)
            ElegantTime(value, ink)
        }
        if (progress < 1f) PaymentConfirmation(progress, ink)
    }
}

@Composable
internal fun ElegantTime(value: String, ink: Color) {
    val parts = value.split(':')
    val main = if (parts.size == 3) "${parts[0].padStart(2, '0')}:${parts[1]}" else value
    val suffix = if (parts.size == 3) parts[2] else ""
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        // Measure actual scaled text: Android uses non-linear font scaling, so dividing
        // sp by fontScale makes the timer smaller when the user asks for larger text.
        val available = with(density) { (maxWidth - 8.dp).toPx() }
        fun widthAt(sp: Float): Int = measurer.measure(AnnotatedString(main), TextStyle(
            fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Normal, fontSize = sp.sp,
            letterSpacing = (-.8).sp, fontFeatureSettings = "tnum"), maxLines = 1, softWrap = false).size.width +
            measurer.measure(AnnotatedString(suffix), TextStyle(fontSize = (sp*.32f).sp,
                fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"), maxLines = 1, softWrap = false).size.width
        val fitted = remember(main, suffix, available, density.fontScale) {
            var low = 32f
            var high = 72f
            repeat(7) { val mid = (low + high) / 2; if (widthAt(mid) <= available) low = mid else high = mid }
            low
        }
        val size = fitted.sp
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(main, color = ink, style = TextStyle(fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Normal, fontSize = size, lineHeight = size * 1.12f,
                letterSpacing = (-.8).sp, fontFeatureSettings = "tnum"),
                maxLines = 1, modifier = Modifier.alignByBaseline().clearAndSetSemantics { })
            if (suffix.isNotEmpty()) Text(suffix, color = ink.copy(alpha = .7f),
                style = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium,
                    fontFeatureSettings = "tnum", fontSize = size * .32f),
                modifier = Modifier.alignByBaseline().clearAndSetSemantics { })
        }
    }
}

@Composable
internal fun PaymentConfirmation(progress: Float, ink: Color) {
    Canvas(Modifier.size(88.dp).clearAndSetSemantics { }.graphicsLayer {
        val exit = ((progress - .67f) / .13f).coerceIn(0f, 1f)
        alpha = 1f - exit
        scaleX = .92f + .08f * minOf(progress / .48f, 1f) - exit * .15f
        scaleY = scaleX
        translationY = -exit * 20.dp.toPx()
    }) {
        val width = 2.8.dp.toPx()
        val inset = width * 2
        val ringSize = Size(size.width - inset*2, size.height - inset*2)
        drawCircle(ink.copy(alpha = .12f), size.width/2-inset, style = Stroke(width))
        val ring = (progress / .48f).coerceIn(0f,1f)
        drawArc(ink, -90f + 25f*ring, 335f*ring, false, Offset(inset,inset), ringSize,
            style = Stroke(width, cap = StrokeCap.Round))
        val check = ((progress-.43f)/.2f).coerceIn(0f,1f)
        val path = Path().apply {
            moveTo(size.width*.29f,size.height*.50f)
            lineTo(size.width*.44f,size.height*.64f)
            lineTo(size.width*.72f,size.height*.35f)
        }
        val measure = PathMeasure().apply { setPath(path, false) }
        val segment = Path()
        measure.getSegment(0f,measure.length*check,segment)
        drawPath(segment,ink,style=Stroke(width,cap=StrokeCap.Round,join=StrokeJoin.Round))
    }
}
