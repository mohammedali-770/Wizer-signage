import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ContentModule } from '../content/content.module';
import { DownloadsModule } from '../downloads/downloads.module';
import { EmergencyBroadcastModule } from '../emergency/emergency-broadcast.module';
import { ImportsModule } from '../imports/imports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledReportsModule } from '../scheduled-reports/scheduled-reports.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { AndroidOtaHealthService } from './android-ota-health.service';
import { BackupService } from './backup.service';
import { ImportCommitWorkerService } from './import-commit-worker.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { RetentionService } from './retention.service';

/**
 * Operational maintenance: retention cleanup, alert sweep, Android OTA health
 * rollback, emergency auto-END, queued imports, scheduled-report runner, and
 * backup health. Driven by the CLI/cron plus Super Admin on-demand endpoints.
 */
@Module({
  imports: [
    ActivityLogModule,
    ContentModule, // ContentCleanupService (trash purge)
    DownloadsModule, // immutable Android release catalog for OTA recovery
    EmergencyBroadcastModule, // endExpired()
    ImportsModule, // queued bulk import commits
    NotificationsModule, // AlertService
    ScheduledReportsModule, // runDue()
    UsageLimitsModule, // evaluate()
  ],
  controllers: [MaintenanceController],
  providers: [
    MaintenanceService,
    RetentionService,
    BackupService,
    AndroidOtaHealthService,
    ImportCommitWorkerService,
  ],
  exports: [
    MaintenanceService,
    RetentionService,
    BackupService,
    AndroidOtaHealthService,
    ImportCommitWorkerService,
  ],
})
export class MaintenanceModule {}
