import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AllowWithoutTwoFactor } from '../../common/decorators/allow-without-two-factor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { SessionsService } from '../sessions/sessions.service';
import { TotpCodeDto, VerifyTwoFactorCodeDto } from './dto/two-factor.dto';
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
  status(@CurrentUser() user: AuthenticatedUser) {
    return {
      required: user.twoFactorRequired,
      satisfied: user.mfaSatisfied,
    };
  }

  @Post('setup')
  @AllowWithoutTwoFactor()
  @ApiOperation({ summary: 'Begin 2FA enrollment (returns secret + QR code).' })
  async setup(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.setup(user.userId);
  }

  @Post('enable')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  @ApiOperation({ summary: 'Verify a code and enable 2FA (returns backup codes once).' })
  async enable(@Body() dto: TotpCodeDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.twoFactor.enable(user.userId, dto.code);
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
  @ApiOperation({ summary: 'Disable 2FA (not permitted when 2FA is mandatory).' })
  async disable(@Body() dto: VerifyTwoFactorCodeDto, @CurrentUser() user: AuthenticatedUser) {
    await this.twoFactor.disable(user.userId, dto.code);
    await this.activityLog.log({
      action: 'two_factor.disabled',
      category: ActivityCategory.TWO_FACTOR,
      targetType: 'user',
      targetId: user.userId,
    });
    return { disabled: true };
  }
}
