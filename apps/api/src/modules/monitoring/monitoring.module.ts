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
