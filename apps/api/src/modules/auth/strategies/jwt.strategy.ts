import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AppConfig } from '../../../config/configuration';
import type { AccessTokenPayload, AuthenticatedUser } from '../../../common/types/auth.types';
import { CompaniesService } from '../../companies/companies.service';
import { SessionsService } from '../../sessions/sessions.service';
import { UsersService } from '../../users/users.service';
import { requiresTwoFactor } from '../../two-factor/two-factor.service';

/**
 * Validates an access token on every protected request and builds the
 * authenticated principal. Beyond signature/expiry it re-checks live state on
 * each request: the session must be valid and within the inactivity window, the
 * user must be active and unlocked, and the company must not be suspended.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly companies: CompaniesService,
  ) {
    const jwt = config.get<AppConfig['jwt']>('jwt', { infer: true });
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt?.accessSecret ?? 'invalid-access-secret',
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }

    // Session validity, expiry, and inactivity window (also advances activity).
    const session = await this.sessions.validateForAccess(payload.sid);

    const user = await this.users.findById(payload.sub);
    if (!user || session.userId !== user.id) {
      throw new UnauthorizedException('Account not found.');
    }
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('Account is disabled.');
    }
    if (this.users.isLocked(user)) {
      throw new UnauthorizedException('Account is locked.');
    }
    if (user.companyId) {
      const company = await this.companies.findById(user.companyId);
      if (!company || this.companies.isSuspended(company)) {
        throw new UnauthorizedException('Company is suspended.');
      }
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      sessionId: session.id,
      isSuperAdmin: user.role === 'SUPER_ADMIN',
      mfaSatisfied: session.mfaSatisfied,
      twoFactorRequired: requiresTwoFactor(user),
    };
  }
}
