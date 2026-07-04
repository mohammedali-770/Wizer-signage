// Wizer Signage TV Player — root build script (Phase 0 skeleton).
// Plugins are declared here with `apply false` and applied per-module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
