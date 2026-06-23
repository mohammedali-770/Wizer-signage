import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ManifestRefreshModule } from '../sync/manifest-refresh.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { ContentCleanupService } from './content-cleanup.service';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [ActivityLogModule, UsageLimitsModule, ManifestRefreshModule],
  controllers: [ContentController],
  providers: [ContentService, ContentCleanupService],
  exports: [ContentService, ContentCleanupService],
})
export class ContentModule {}
