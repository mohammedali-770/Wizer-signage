import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  imports: [ActivityLogModule, SessionsModule, UsageLimitsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
