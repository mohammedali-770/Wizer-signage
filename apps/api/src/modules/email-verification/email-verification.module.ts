import { Module } from '@nestjs/common';

import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';

/**
 * Its own module because two unrelated callers need it: PublicModule issues a
 * token during trial signup, and AuthModule consumes one and gates login on the
 * result. Putting the service in either would have made the other import a
 * module it has no other business with.
 *
 * No imports: PrismaModule, MailModule and CommonModule (CryptoService) are all
 * @Global, and ConfigModule is registered globally in AppModule.
 */
@Module({
  controllers: [EmailVerificationController],
  providers: [EmailVerificationService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
