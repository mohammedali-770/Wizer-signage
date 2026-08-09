import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}

// API base URL baked into BuildConfig.API_BASE_URL. Defaults to PRODUCTION so no
// build (debug or release) ever ships the Android-emulator loopback URL by
// accident. Override at build time for local emulator development:
//   ./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:3001/api
//
// MUST be the host nginx actually serves (server_name signage.wizer.sa; see
// infra/docker/.env.production.example). OTA can recover a bad build only after
// that build can still reach the API/release host, so production release tooling
// continues to require this value explicitly.
val apiBaseUrl: String = (project.findProperty("apiBaseUrl") as String?)
    ?: "https://signage.wizer.sa/api"

// Development/CI builds keep deterministic defaults. A production signed build
// uses scripts/build-android-release.sh, which requires both properties on every
// invocation so OTA versionCode is intentionally monotonic rather than a source
// edit someone can forget.
val releaseVersionCodeProp = project.findProperty("releaseVersionCode") as String?
val appVersionCode = releaseVersionCodeProp?.toIntOrNull()?.takeIf { it > 0 }
    ?: if (releaseVersionCodeProp == null) 1 else throw GradleException("releaseVersionCode must be a positive integer")
val releaseVersionNameProp = (project.findProperty("releaseVersionName") as String?)?.trim()
val appVersionName = when {
    releaseVersionNameProp == null -> "0.6.0"
    releaseVersionNameProp.matches(Regex("^[A-Za-z0-9._-]{1,40}$")) -> releaseVersionNameProp
    else -> throw GradleException("releaseVersionName must match [A-Za-z0-9._-]{1,40}")
}

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
        versionCode = appVersionCode
        versionName = appVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                val keystore = rootProject.file(signingEnv.getValue("WIZER_ANDROID_KEYSTORE_PATH")!!)
                require(keystore.exists() && keystore.isFile && keystore.canRead()) {
                    "Keystore at WIZER_ANDROID_KEYSTORE_PATH is missing or unreadable: ${keystore.absolutePath}"
                }
                storeFile = keystore
                storePassword = signingEnv.getValue("WIZER_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingEnv.getValue("WIZER_ANDROID_KEY_ALIAS")
                keyPassword = signingEnv.getValue("WIZER_ANDROID_KEY_PASSWORD")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
            freeCompilerArgs.add("-opt-in=androidx.media3.common.util.UnstableApi")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

tasks.withType<Test>().configureEach {
    val contracts = rootProject.layout.projectDirectory.dir("../../contracts")
    if (contracts.asFile.isDirectory) {
        inputs.dir(contracts)
            .withPropertyName("sharedContractFixtures")
            .withPathSensitivity(PathSensitivity.RELATIVE)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.leanback)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.media3.ui)
    implementation(libs.coil.compose)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.androidx.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}
