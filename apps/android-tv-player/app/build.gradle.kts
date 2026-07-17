plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

// API base URL baked into BuildConfig.API_BASE_URL. Defaults to PRODUCTION so no
// build (debug or release) ever ships the Android-emulator loopback URL by
// accident. Override at build time for local emulator development:
//   ./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:3001/api
val apiBaseUrl: String = (project.findProperty("apiBaseUrl") as String?)
    ?: "https://wizer.sa/api"

// -----------------------------------------------------------------------------
// Release signing — credentials come ONLY from environment variables, never from
// tracked files, hardcoded values, or the command line. See scripts/
// build-android-release.sh and docs/android-signing.md.
//
//   Zero of the four vars set  -> no release signingConfig; `assembleRelease`
//                                 emits an UNSIGNED, non-distributable APK.
//                                 Keeps debug builds and CI/dev flows working
//                                 without any production secret.
//   Some but not all set       -> fail the configuration immediately, listing
//                                 ONLY the missing variable names (no values).
//   All four set               -> validate the keystore is present + readable,
//                                 then sign the release build (v1+v2+v3).
// -----------------------------------------------------------------------------
val signingEnv: Map<String, String?> = linkedMapOf(
    "WIZER_ANDROID_KEYSTORE_PATH" to System.getenv("WIZER_ANDROID_KEYSTORE_PATH"),
    "WIZER_ANDROID_KEYSTORE_PASSWORD" to System.getenv("WIZER_ANDROID_KEYSTORE_PASSWORD"),
    "WIZER_ANDROID_KEY_ALIAS" to System.getenv("WIZER_ANDROID_KEY_ALIAS"),
    "WIZER_ANDROID_KEY_PASSWORD" to System.getenv("WIZER_ANDROID_KEY_PASSWORD"),
)
val suppliedSigningVars = signingEnv.filterValues { !it.isNullOrBlank() }
val hasReleaseSigning: Boolean = when (suppliedSigningVars.size) {
    0 -> false
    4 -> true
    else -> {
        // Partial credentials → fail closed. Report only the missing NAMES so no
        // secret value can leak into build logs or the exception message.
        val missing = signingEnv.filterValues { it.isNullOrBlank() }.keys.joinToString(", ")
        throw GradleException(
            "Incomplete Android release signing configuration. " +
                "Set all four WIZER_ANDROID_* variables or none. Missing: $missing",
        )
    }
}

android {
    namespace = "com.wizer.signage"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wizer.signage"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "0.6.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Production by default (see apiBaseUrl above). Override with
        // -PapiBaseUrl=http://10.0.2.2:3001/api for the local emulator.
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // rootProject.file() resolves an absolute path as-is and a relative
                // path against the android project root — no secret is embedded here.
                val keystore = rootProject.file(signingEnv.getValue("WIZER_ANDROID_KEYSTORE_PATH")!!)
                require(keystore.exists() && keystore.isFile && keystore.canRead()) {
                    // Path only (an env var name/value the operator supplied) — never a password.
                    "Keystore at WIZER_ANDROID_KEYSTORE_PATH is missing or unreadable: ${keystore.absolutePath}"
                }
                storeFile = keystore
                storePassword = signingEnv.getValue("WIZER_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingEnv.getValue("WIZER_ANDROID_KEY_ALIAS")
                keyPassword = signingEnv.getValue("WIZER_ANDROID_KEY_PASSWORD")
                // minSdk 21 needs the v1 (JAR) scheme; v2 (API 24+) and v3 (API 28+,
                // adds key-rotation support) are backward-compatible. All enabled so
                // the APK installs on Android 5.0+ and is future-proof.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            // Phase 0: keep minification off so the skeleton builds without a full
            // ProGuard/R8 rule set. Enable in a later hardening phase.
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Signed only when all four WIZER_ANDROID_* vars are present (see above).
            // Otherwise the release build is intentionally UNSIGNED and NOT
            // distributable — use scripts/build-android-release.sh for real releases.
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        // Media3 (ExoPlayer/PlayerView) APIs are annotated @UnstableApi, which is
        // @RequiresOptIn(level = ERROR). Opt the whole module in so usages compile
        // without a per-call @OptIn and Kotlin doesn't fail with opt-in errors.
        freeCompilerArgs += "-opt-in=androidx.media3.common.util.UnstableApi"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        // Compose Compiler extension compatible with Kotlin 1.9.24.
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX core / lifecycle / activity.
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    // Android TV (leanback).
    implementation(libs.androidx.leanback)

    // Compose (BOM-managed versions).
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)

    // ViewModel in Compose.
    implementation(libs.androidx.lifecycle.viewmodel.compose)

    // Secure local storage for the device token / pairing secret (API 23+).
    implementation(libs.androidx.security.crypto)

    // Media3 / ExoPlayer (video playback).
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)

    // Image loading.
    implementation(libs.coil.compose)

    // Networking + JSON + coroutines (manifest/pairing client).
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    // Debug tooling.
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Tests.
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
