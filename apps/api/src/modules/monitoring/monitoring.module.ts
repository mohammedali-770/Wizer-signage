import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DeviceModule } from '../device/device.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceCommandService } from './device-command.service';
import { DeviceCrashService } from './device-crash.service';
import { DeviceTelemetryController } from './device-telemetry.controller';
import { FleetHealthController } from './fleet-health.controller';
import { FleetHealthService } from './fleet-health.service';
import { HeartbeatService } from './heartbeat.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ScreenMonitoringController } from './screen-monitoring.controller';
import { ScreenshotService } from './screenshot.service';

/**
 * Phase 8 — monitoring, heartbeat, remote commands, screenshots, and bounded
 * crash/version fleet diagnostics. Imports DeviceModule for the exported
 * DeviceAuthGuard used by device-facing routes. Storage is global.
 *
 * Crash reports intentionally contain only a timestamp, short fingerprint,
 * cumulative count and app version; raw Android stack traces remain on-device.
 */
@Module({
  imports: [ActivityLogModule, DeviceModule, NotificationsModule],
  controllers: [
    DeviceTelemetryController,
    ScreenMonitoringController,
    MonitoringController,
    FleetHealthController,
  ],
  providers: [
    HeartbeatService,
    MonitoringService,
    DeviceCommandService,
    ScreenshotService,
    DeviceCrashService,
    FleetHealthService,
  ],
  exports: [MonitoringService, DeviceCommandService],
})
export class MonitoringModule {}
