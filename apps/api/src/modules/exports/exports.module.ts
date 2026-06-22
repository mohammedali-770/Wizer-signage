import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ExportService } from './export.service';
import { ExportsController } from './exports.controller';

/**
 * Phase 10 — tenant-scoped data exports (CSV/XLSX/PDF). Exports ExportService so
 * the scheduled-report runner can reuse the same dataset builders + renderers.
 */
@Module({
  imports: [ActivityLogModule],
  controllers: [ExportsController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportsModule {}
