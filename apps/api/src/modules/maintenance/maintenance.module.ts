import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ContentModule } from '../content/content.module';
import { EmergencyBroadcastModule } from '../emergency/emergency-broadcast.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledReportsModule } from '../scheduled-reports/scheduled-reports.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { BackupService } from './backup.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { RetentionService } from './retention.service';

/**
 * Phase 10 — operational maintenance: retention cleanup, alert sweep, emergency
 * auto-END, scheduled-report runner, and backup health. Driven by the CLI/cron
 * (maintenance.cli.ts) plus Super Admin on-demand endpoints. Reuses existing
 * services rather than duplicating their logic.
 */
@Module({
  imports: [
    ActivityLogModule,
    ContentModule, // ContentCleanupService (trash purge)
    EmergencyBroadcastModule, // endExpired()
    NotificationsModule, // AlertService
    ScheduledReportsModule, // runDue()
    UsageLimitsModule, // evaluate()
  ],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, RetentionService, BackupService],
  exports: [MaintenanceService, RetentionService, BackupService],
})
export class MaintenanceModule {}
