# MasterSignage TV Player — ProGuard / R8 rules (Phase 0 placeholder).
#
# Minification is currently disabled (see app/build.gradle.kts: isMinifyEnabled = false),
# so no rules are strictly required yet. Add keep rules here when R8 is enabled in a
# later hardening phase — likely for:
#   - Media3 / ExoPlayer reflective components
#   - Kotlin serialization / Gson model classes (DTOs from the API)
#   - Any classes referenced only from the AndroidManifest (services, receivers)
#
# Example (commented until needed):
# -keep class com.mastersignage.player.data.model.** { *; }

# Keep generic line numbers for readable crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
