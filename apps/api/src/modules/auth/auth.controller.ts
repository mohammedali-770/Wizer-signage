import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';

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
  ResetPasswordDto,
  TwoFactorLoginDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'wizer_refresh';
const REFRESH_COOKIE_PATH = '/api/auth/refresh';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

function jwtMaxAgeMs(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    if (typeof decoded.exp !== 'number') return undefined;
    return Math.max(0, decoded.exp * 1000 - Date.now());
  } catch {
    // The service has just signed this token; absence of a parseable exp should
    // not make login fail. The cookie simply becomes a browser-session cookie.
    return undefined;
  }
}

@ApiTags('auth')
// Referenced only inside a oneOf, so Swagger would not otherwise emit them.
@ApiExtraModels(AuthTokensDto, TwoFactorChallengeDto)
@Controller('auth')
export class AuthController {
  private readonly dashboardOrigin: string;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    const dashboardUrl = config.get<string>('app.dashboardUrl') ?? 'http://localhost:3000';
    this.dashboardOrigin = new URL(dashboardUrl).origin;
  }

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
  async login(
    @Body() dto: LoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, meta);
    if ('requiresTwoFactor' in result) return result;
    return this.establishBrowserSession(response, result);
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete login by verifying a 2FA code.' })
  @ApiOkResponse({ type: AuthTokensDto })
  async loginTwoFactor(
    @Body() dto: TwoFactorLoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyTwoFactorLogin(dto, meta);
    return this.establishBrowserSession(response, result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  // Unauthenticated and token-guessing-shaped, exactly like /login — it was the
  // only @Public() auth route left on the 100/min global default. A legitimate
  // client refreshes at most a few times an hour.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate the HttpOnly refresh cookie and return a new access token.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertBrowserRefreshOrigin(request);
    const refreshToken = this.readRefreshCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh session is missing or expired.');
    }
    const result = await this.auth.refresh(refreshToken);
    return this.establishBrowserSession(response, result);
  }

  @Post('logout')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logout(user);
    response.clearCookie(REFRESH_COOKIE, cookieOptions());
    return result;
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

  private establishBrowserSession<T extends { refreshToken: string }>(
    response: Response,
    result: T,
  ): Omit<T, 'refreshToken'> {
    const { refreshToken, ...publicResult } = result;
    const maxAge = jwtMaxAgeMs(refreshToken);
    response.cookie(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions(),
      ...(maxAge === undefined ? {} : { maxAge }),
    });
    return publicResult;
  }

  private readRefreshCookie(request: Request): string | null {
    const header = request.headers.cookie;
    if (!header) return null;

    for (const part of header.split(';')) {
      const [rawName, ...rawValue] = part.trim().split('=');
      if (rawName !== REFRESH_COOKIE) continue;
      const value = rawValue.join('=');
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
    return null;
  }

  private assertBrowserRefreshOrigin(request: Request): void {
    const fetchSite = request.get('sec-fetch-site');
    if (fetchSite?.toLowerCase() === 'cross-site') {
      throw new ForbiddenException('Cross-site refresh requests are not allowed.');
    }

    // Browsers send Origin on fetch/XHR POSTs. Tests and non-browser health
    // harnesses may omit it; the HttpOnly + SameSite=Strict cookie still remains
    // the authentication factor in that case. If Origin is present, it must be
    // the configured dashboard origin rather than an arbitrary website.
    const origin = request.get('origin');
    if (origin && origin !== this.dashboardOrigin) {
      throw new ForbiddenException('Refresh origin is not allowed.');
    }
  }
}
