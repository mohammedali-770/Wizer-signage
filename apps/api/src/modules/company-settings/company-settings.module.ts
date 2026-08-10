import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DownloadsModule } from '../downloads/downloads.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { CompanySettingsController } from './company-settings.controller';
import { CompanySettingsService } from './company-settings.service';

@Module({
  imports: [ActivityLogModule, DownloadsModule, UsageLimitsModule],
  controllers: [CompanySettingsController],
  providers: [CompanySettingsService],
  exports: [CompanySettingsService],
})
export class CompanySettingsModule {}
