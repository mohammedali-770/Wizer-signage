# Android TV / Google TV Device Limitations

The MasterSignage player runs on a wide range of Android TV and Google TV
hardware. Some behaviors that are essential for unattended digital signage —
kiosk lock, auto-start on boot, and power control — are **not uniformly
available** on consumer devices. What works depends heavily on the OEM and on
whether the device is _provisioned_ (the app is the device owner, or the device
is managed via an MDM / EMM).

This document lists the known caveats, gives a capability matrix, and recommends
how to deploy for reliable operation. It complements
[android-player.md](./android-player.md) (capabilities by phase) and
[pairing-guide.md](./pairing-guide.md).

> Key principle: the player must **detect** which of these capabilities it
> actually has on the current device and **report** that to the dashboard, so
> operators see honest status for **kiosk**, **auto-start**, and **power**
> rather than silently failing.

---

## Known caveats

### Kiosk / lock-task mode

Android's lock-task ("screen pinning" / kiosk) behavior varies by OEM. True,
non-dismissible kiosk requires the app to be the **device owner** or to be
allow-listed by an **MDM/EMM** that provisions lock-task mode. On an ordinary
consumer TV the app can request pinning, but the user can typically still exit,
and some OEM launchers reassert themselves. Reliable kiosk therefore needs a
provisioned/enterprise device.

### Auto-start on boot

Restarting automatically after a power cycle relies on the
`RECEIVE_BOOT_COMPLETED` broadcast. Many consumer Android TV / Google TV models
**restrict or block** auto-launch of third-party apps on boot (battery/UX
policies, OEM launcher behavior, or background-start limits on newer Android).
On provisioned/device-owner setups, boot launch is dependable; on consumer
hardware it is best-effort and frequently does not fire.

### Power on/off control

Programmatically powering the TV **on or off** is largely **unsupported** on
consumer hardware — there is no general Android API for a third-party app to
turn the panel off and back on. Instead, within the app the player can simulate
"off" by showing a **black screen / sleep state** (and keeping itself in the
foreground) during off-hours, then resume playback on schedule. Hardware power
scheduling, if needed, is an OEM/CEC concern outside the app.

### Immersive full-screen & keep-awake

These are **generally available** across devices: the player runs immersive,
full-screen (hiding system bars where present) and holds a keep-screen-on flag
so the panel does not sleep during playback. This is the baseline that works
almost everywhere.

### Screenshots

Capturing a frame of the live screen may require **special permission** or
platform support (e.g. the MediaProjection capture consent, or device-owner /
system privileges to capture silently). On unprovisioned consumer devices,
silent server-triggered screenshots may be unavailable or require a one-time
user grant.

---

## Capability matrix

| Capability                 | Typical consumer TV                     | Provisioned / Enterprise (device-owner or MDM) | Notes                                                                    |
| -------------------------- | --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Immersive full-screen      | Yes                                     | Yes                                            | Baseline; works almost everywhere.                                       |
| Keep awake (no sleep)      | Yes                                     | Yes                                            | Keep-screen-on flag held during playback.                                |
| Media playback (ExoPlayer) | Yes                                     | Yes                                            | Core function; codec support varies by chipset.                          |
| Kiosk / lock-task          | Partial — user can usually exit         | Yes — true non-dismissible kiosk               | Requires device owner or MDM lock-task allow-list.                       |
| Auto-start on boot         | Unreliable — often blocked/restricted   | Yes — dependable                               | Depends on `RECEIVE_BOOT_COMPLETED` being honored.                       |
| Power on/off (hardware)    | No                                      | Limited / OEM-specific (e.g. CEC)              | App falls back to in-app black-screen/sleep.                             |
| In-app black-screen sleep  | Yes                                     | Yes                                            | App-level "off-hours" without hardware power.                            |
| Silent screenshots         | Often requires permission / unavailable | Yes (system/device-owner privileges)           | Consumer devices may need a one-time consent.                            |
| Silent in-app APK update   | Requires "install unknown apps" grant   | Yes — silent install                           | Same-key signing required; see [android-player.md](./android-player.md). |

"Yes/No" describes the typical case; individual OEM firmware can differ.

---

## Detect and report

Because behavior is device-specific, the player evaluates its environment at
runtime and reports a **capability report** to the dashboard (via heartbeat /
monitoring telemetry, Phase 8). At minimum it reports whether the device
supports:

- **kiosk** (lock-task available and effective),
- **auto-start** (boot launch permitted),
- **power** (hardware power control available).

The dashboard surfaces these flags so operators know, per screen, what to expect
and can raise alerts when a screen reports an unsupported capability it was
expected to have.

---

## Recommendations

- **For full kiosk signage, use dedicated provisioned devices.** Make the player
  the **device owner** (provisioned at factory reset) or manage the device with
  an **MDM/EMM**. This unlocks reliable lock-task kiosk, dependable auto-start on
  boot, and silent screenshots/updates.
- **Prefer purpose-built signage/TV boxes** over generic consumer smart TVs when
  unattended reliability matters; consumer TVs are best-effort for kiosk and
  boot behavior.
- **Use in-app black-screen sleep** for off-hours instead of relying on hardware
  power control, which is generally unavailable.
- **Treat capability flags as truth.** Plan deployments around what each device
  actually reports, not what is theoretically possible.

---

## Related documentation

- [android-player.md](./android-player.md) — player capabilities by phase.
- [pairing-guide.md](./pairing-guide.md) — linking devices to screens.
- [admin-guide.md](./admin-guide.md) — remote actions and monitoring.
