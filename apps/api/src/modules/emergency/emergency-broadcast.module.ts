import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { EmergencyBroadcastController } from './emergency-broadcast.controller';
import { EmergencyBroadcastService } from './emergency-broadcast.service';

/**
 * Phase 9 — Emergency Broadcast. Imports SchedulesModule (target expansion /
 * screen index) and MonitoringModule (DeviceCommandService, for the
 * REFRESH_MANIFEST fan-out on activation/pause/end). The resolver's
 * emergency-first pre-emption lives in SchedulesModule.
 */
@Module({
  imports: [ActivityLogModule, SchedulesModule, MonitoringModule, NotificationsModule],
  controllers: [EmergencyBroadcastController],
  providers: [EmergencyBroadcastService],
  exports: [EmergencyBroadcastService],
})
export class EmergencyBroadcastModule {}
