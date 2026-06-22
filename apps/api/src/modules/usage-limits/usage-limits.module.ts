import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { UsageLimitsService } from './usage-limits.service';

@Module({
  imports: [ActivityLogModule],
  providers: [UsageLimitsService],
  exports: [UsageLimitsService],
})
export class UsageLimitsModule {}
