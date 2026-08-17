import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/**
 * Public, unauthenticated API for the marketing website (trial signup, demo
 * requests, public plans). PrismaService, PasswordService (CommonModule) and
 * MailService are global; only ActivityLogModule needs importing.
 */
@Module({
  imports: [ActivityLogModule, EmailVerificationModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
