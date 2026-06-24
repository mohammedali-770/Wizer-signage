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
    ?: "https://signage.spicymeal.com.sa/api"

android {
    namespace = "com.mastersignage.player"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.mastersignage.player"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "0.6.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Production by default (see apiBaseUrl above). Override with
        // -PapiBaseUrl=http://10.0.2.2:3001/api for the local emulator.
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
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
