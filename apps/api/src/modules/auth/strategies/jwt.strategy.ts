import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole, UserStatus } from '@prisma/client';
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
    // isBlocked, not isLocked: an indefinite administrative lock (status LOCKED
    // with no lockedUntil) was previously accepted by every check in the system.
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException('Account is disabled.');
    }
    if (this.users.isBlocked(user)) {
      throw new UnauthorizedException('Account is locked.');
    }
    // The SESSION is the authority on impersonation, not the token: ending an
    // impersonation revokes the session, and a token minted before that must
    // not keep working just because it carries the claim. The `imp` claim is
    // only a hint for clients.
    const impersonating = !!session.impersonatorId;
    if (impersonating) {
      // An impersonation session must still belong to the admin who started it,
      // AND that admin must still be a Super Admin. Without the second check, a
      // demoted admin would keep a token whose tenant context is someone else's
      // company while no longer holding platform authority — quietly becoming a
      // member of a tenant they were never granted.
      if (session.impersonatorId !== user.id || user.role !== UserRole.SUPER_ADMIN) {
        throw new UnauthorizedException('Session is no longer valid.');
      }
    }

    // Check the company the request will actually ACT IN. A Super Admin's own
    // `user.companyId` is null, so keying this off the user row would skip the
    // suspension check entirely for the tenant being impersonated.
    const effectiveCompanyId = impersonating ? session.companyId : user.companyId;
    if (effectiveCompanyId) {
      const company = await this.companies.findById(effectiveCompanyId);
      if (!company || this.companies.isSuspended(company)) {
        throw new UnauthorizedException('Company is suspended.');
      }
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      // While impersonating, the tenant context comes from the SESSION, so
      // every `@CurrentCompany` route resolves to the tenant being supported
      // rather than to the admin's own (null) company.
      companyId: effectiveCompanyId,
      sessionId: session.id,
      isSuperAdmin: user.role === 'SUPER_ADMIN',
      mfaSatisfied: session.mfaSatisfied,
      twoFactorRequired: requiresTwoFactor(user),
      impersonatorId: session.impersonatorId,
    };
  }
}
