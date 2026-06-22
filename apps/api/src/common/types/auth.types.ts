import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

/**
 * The authenticated principal attached to `req.user` by the JWT strategy.
 * `companyId` is ALWAYS derived from the verified token — never from client
 * input (see docs/multi-tenancy.md).
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  /** null only for SUPER_ADMIN (platform-level). */
  companyId: string | null;
  sessionId: string;
  isSuperAdmin: boolean;
  /** Whether 2FA was satisfied for this session. */
  mfaSatisfied: boolean;
  /** Whether 2FA is mandatory for this user (Super Admin or company-enforced). */
  twoFactorRequired: boolean;
}

/** Token "kind" carried in the `typ` claim. */
export type TokenType = 'access' | 'refresh' | '2fa_challenge' | '2fa_enroll';

/** Access token claims. */
export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
  role: UserRole;
  cid: string | null; // companyId
  mfa: boolean;
  typ: 'access';
}

/** Refresh token claims. */
export interface RefreshTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
  typ: 'refresh';
}

/** Short-lived token issued between password step and TOTP step at login. */
export interface TwoFactorChallengePayload {
  sub: string; // userId
  cid: string; // TwoFactorChallenge id — server-side single-use record
  typ: '2fa_challenge';
}

/** Short-lived token forcing 2FA enrollment (e.g. Super Admin without 2FA). */
export interface TwoFactorEnrollPayload {
  sub: string; // userId
  typ: '2fa_enroll';
}

/** Express request with the authenticated principal attached. */
export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}
