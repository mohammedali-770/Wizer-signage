import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ExportsModule } from '../exports/exports.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledReportQueueService } from './scheduled-report-queue.service';
import { ScheduledReportService } from './scheduled-report.service';
import { ScheduledReportsController } from './scheduled-reports.controller';

/**
 * Phase 10 — scheduled reports. Reuses ExportService (render) + EmailService
 * (deliver) + AlertService (failure alert). StorageService is global. Execution
 * is driven by the maintenance CLI/cron via runDue(), not an in-process timer.
 */
@Module({
  imports: [ActivityLogModule, ExportsModule, NotificationsModule],
  controllers: [ScheduledReportsController],
  providers: [ScheduledReportService, ScheduledReportQueueService],
  exports: [ScheduledReportService, ScheduledReportQueueService],
})
export class ScheduledReportsModule {}
