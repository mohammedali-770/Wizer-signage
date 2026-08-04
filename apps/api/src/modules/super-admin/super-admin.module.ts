import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { UsersModule } from '../users/users.module';
import { ImpersonationService } from './impersonation.service';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [
    UsersModule,
    InvitationsModule,
    ActivityLogModule,
    SessionsModule,
    TwoFactorModule,
    JwtModule.register({}),
  ],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, ImpersonationService],
})
export class SuperAdminModule {}
