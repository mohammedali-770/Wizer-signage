import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CompaniesModule } from '../companies/companies.module';
import { UsageLimitsModule } from '../usage-limits/usage-limits.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [CompaniesModule, ActivityLogModule, UsageLimitsModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
