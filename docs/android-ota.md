# Android OTA update channel

Wizer's signed release publisher is the source of immutable APK artifacts and the atomic `android/latest.json` pointer. The API exposes only the canonical files emitted by that publisher; arbitrary files in the downloads mount remain private.

The player treats release metadata as untrusted input. Before downloading it checks the Wizer package name, schema, forward-only `versionCode`, device `minSdk`, canonical immutable filename/path, and SHA-256/certificate-fingerprint syntax. The APK is streamed to a `.part` file and is committed only when its final size and SHA-256 match the manifest.

This foundation does **not** install an APK simply because it is newer. Rollout eligibility must come from an authenticated server decision, and unattended installation is enabled only on a managed/device-owner player. The next OTA layer verifies the staged APK's signer against the currently installed Wizer signer, then hands it to `PackageInstaller`; unmanaged devices report that OTA is unavailable instead of opening an installation prompt over signage playback.