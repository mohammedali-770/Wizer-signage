package com.mastersignage.player.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

// TV signage is effectively always dark; we expose a single dark scheme but keep the
// `darkTheme` hook so a light variant can be added later without changing call sites.
private val WizerSignageDarkColors = darkColorScheme(
    primary = BrandPrimary,
    onPrimary = OnSurfaceDark,
    secondary = BrandSecondary,
    tertiary = BrandAccent,
    background = SurfaceDark,
    onBackground = OnSurfaceDark,
    surface = SurfaceDarkElevated,
    onSurface = OnSurfaceDark,
    surfaceVariant = SurfaceDarkElevated,
    onSurfaceVariant = OnSurfaceMutedDark,
    error = ErrorDark,
)

@Composable
fun WizerSignageTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    // Phase 0: always dark. `darkTheme` is reserved for a future light scheme.
    val colorScheme = WizerSignageDarkColors

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content,
    )
}
