import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { AllowWithoutTwoFactor } from '../../common/decorators/allow-without-two-factor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ReqMeta, type RequestMeta } from '../../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { SuccessResponseDto } from '../../common/dto/api-response.dto';
import { AuthService } from './auth.service';
import {
  AcceptInvitationResponseDto,
  AuthTokensDto,
  MeResponseDto,
  TwoFactorChallengeDto,
} from './dto/auth-response.dto';
import {
  AcceptInvitationDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  TwoFactorLoginDto,
} from './dto/auth.dto';

@ApiTags('auth')
// Referenced only inside a oneOf, so Swagger would not otherwise emit them.
@ApiExtraModels(AuthTokensDto, TwoFactorChallengeDto)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate with email + password (may require 2FA).' })
  // TWO shapes, not one. An account with 2FA gets a challenge and NO tokens;
  // documenting only the token shape would promise clients an accessToken that
  // is not there.
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthTokensDto) },
        { $ref: getSchemaPath(TwoFactorChallengeDto) },
      ],
    },
  })
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete login by verifying a 2FA code.' })
  @ApiOkResponse({ type: AuthTokensDto })
  loginTwoFactor(@Body() dto: TwoFactorLoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyTwoFactorLogin(dto, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  // Unauthenticated and token-guessing-shaped, exactly like /login — it was the
  // only @Public() auth route left on the 100/min global default. A legitimate
  // client refreshes at most a few times an hour.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair.' })
  @ApiOkResponse({ type: AuthTokensDto })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password-reset email.' })
  // Always { success: true }, whether or not the address exists — the response
  // is deliberately uniform so it cannot be used to enumerate accounts.
  @ApiOkResponse({ type: SuccessResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.forgotPassword(dto, meta);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset a password with a valid reset token.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.resetPassword(dto, meta);
  }

  @Public()
  @Post('accept-invitation')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept an invitation and create the account.' })
  @ApiOkResponse({ type: AcceptInvitationResponseDto })
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.auth.acceptInvitation(dto);
  }

  @Get('me')
  @AllowWithoutTwoFactor()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user, permissions, and 2FA status.' })
  @ApiOkResponse({ type: MeResponseDto })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user);
  }
}
