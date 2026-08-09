import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DeviceModule } from '../device/device.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceCommandService } from './device-command.service';
import { DeviceCrashService } from './device-crash.service';
import { DeviceTelemetryController } from './device-telemetry.controller';
import { HeartbeatService } from './heartbeat.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ScreenMonitoringController } from './screen-monitoring.controller';
import { ScreenshotService } from './screenshot.service';

/**
 * Phase 8 — monitoring, heartbeat, remote commands, screenshots, and bounded
 * crash telemetry. Imports DeviceModule for the exported DeviceAuthGuard
 * (device-facing routes). Storage is global.
 */
@Module({
  imports: [ActivityLogModule, DeviceModule, NotificationsModule],
  controllers: [DeviceTelemetryController, ScreenMonitoringController, MonitoringController],
  providers: [
    HeartbeatService,
    MonitoringService,
    DeviceCommandService,
    ScreenshotService,
    DeviceCrashService,
  ],
  exports: [MonitoringService, DeviceCommandService],
})
export class MonitoringModule {}