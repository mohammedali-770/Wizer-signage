import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CompaniesModule } from '../companies/companies.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // Secrets/TTLs are passed per-sign/verify call (access vs refresh differ).
    JwtModule.register({}),
    UsersModule,
    SessionsModule,
    CompaniesModule,
    TwoFactorModule,
    InvitationsModule,
    ActivityLogModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
