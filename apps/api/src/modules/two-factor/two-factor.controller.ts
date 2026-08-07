import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AllowWithoutTwoFactor } from '../../common/decorators/allow-without-two-factor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  BeginTwoFactorSetupDto,
  EnableTwoFactorDto,
  VerifyTwoFactorCodeDto,
} from './dto/two-factor.dto';
import {
  DisabledResponseDto,
  TwoFactorBackupCodesDto,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
} from './dto/two-factor-response.dto';
import { TwoFactorService } from './two-factor.service';

@ApiTags('two-factor')
@ApiBearerAuth()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get('status')
  @AllowWithoutTwoFactor()
  @ApiOperation({ summary: 'Current 2FA status for the authenticated user.' })
  @ApiOkResponse({ type: TwoFactorStatusDto })
  status(@CurrentUser() user: AuthenticatedUser) {
    return {
      required: user.twoFactorRequired,
      satisfied: user.mfaSatisfied,
    };
  }

  @Post('setup')
  @AllowWithoutTwoFactor()
  // Every route below re-checks the password, which makes each one an Argon2
  // verification and a password oracle for anyone holding a stolen token. The
  // per-account lockout in the service is the real bound; this keeps a single
  // client from spending CPU freely between lockouts.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Begin 2FA enrollment (returns secret + QR code). Requires the password.',
  })
  // A bare @Post: 201. Returns the TOTP secret in plaintext — see the DTO.
  @ApiCreatedResponse({ type: TwoFactorSetupDto })
  async setup(@Body() dto: BeginTwoFactorSetupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.setup(user.userId, dto);
  }

  @Post('enable')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a code and enable 2FA (returns backup codes once). Requires the password.',
  })
  @ApiOkResponse({ type: TwoFactorBackupCodesDto })
  async enable(@Body() dto: EnableTwoFactorDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.twoFactor.enable(user.userId, dto.code, dto);
    // The user just proved possession of the TOTP secret — satisfy 2FA for the
    // current session so a forced-enrollment principal gains full access.
    await this.sessions.markMfaSatisfied(user.sessionId);
    await this.activityLog.log({
      action: 'two_factor.enabled',
      category: ActivityCategory.TWO_FACTOR,
      targetType: 'user',
      targetId: user.userId,
    });
    return result;
  }

  @Post('disable')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Disable 2FA (not permitted when 2FA is mandatory). Requires the password and a code.',
  })
  @ApiOkResponse({ type: DisabledResponseDto })
  async disable(@Body() dto: VerifyTwoFactorCodeDto, @CurrentUser() user: AuthenticatedUser) {
    await this.twoFactor.disable(user.userId, dto.code, dto.password);
    await this.activityLog.log({
      action: 'two_factor.disabled',
      category: ActivityCategory.TWO_FACTOR,
      targetType: 'user',
      targetId: user.userId,
    });
    return { disabled: true };
  }
}
