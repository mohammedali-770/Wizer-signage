import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import {
  ConfirmEmailDto,
  EmailVerificationResultDto,
  ResendVerificationDto,
  ResendVerificationResultDto,
} from './dto/email-verification.dto';
import { EmailVerificationService } from './email-verification.service';

/**
 * Email confirmation for public trial signups.
 *
 * Both routes are `@Public()` by necessity — the whole point is that the caller
 * cannot log in yet — so both are throttled harder than the global budget.
 */
@ApiTags('auth')
@Public()
@Controller('auth/email')
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('confirm')
  @HttpCode(200)
  // Tight: a token is 32 random bytes, so this is not a guessing budget so much
  // as a cap on how fast someone can churn through the attempt.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm an email address using the token from the emailed link.' })
  @ApiOkResponse({ type: EmailVerificationResultDto })
  async confirm(@Body() dto: ConfirmEmailDto): Promise<EmailVerificationResultDto> {
    const { email } = await this.verification.confirm(dto.token);
    return { success: true, email };
  }

  @Post('resend')
  @HttpCode(200)
  // Each accepted call sends mail to an address the caller chose, so this is
  // also the abuse budget for using us as a mailer. 3/hour/IP.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Request a fresh confirmation link.',
    description:
      'Always returns success. Whether an email is actually sent depends on the address ' +
      'existing and still being unverified, which is deliberately not revealed.',
  })
  @ApiOkResponse({ type: ResendVerificationResultDto })
  async resend(@Body() dto: ResendVerificationDto): Promise<ResendVerificationResultDto> {
    await this.verification.resend(dto.email);
    return { success: true };
  }
}
