import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TwoFactorService, requiresTwoFactor } from './two-factor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VALID_CODE = '123456';
const PASSWORD = 'correct-horse-battery-staple';
/** The proof a caller must now supply; `currentCode` matters only when 2FA is on. */
const PROOF = { password: PASSWORD, currentCode: VALID_CODE };

function build(
  overrides: {
    user?: any;
    crypto?: Partial<CryptoService>;
    passwordValid?: boolean;
    blocked?: boolean;
  } = {},
) {
  const user = {
    id: 'u1',
    email: 'admin@example.com',
    role: UserRole.SUPER_ADMIN,
    passwordHash: 'argon:hash',
    failedLoginCount: 0,
    lockedUntil: null,
    twoFactorEnabled: true,
    twoFactorSecret: 'enc:secret',
    twoFactorPendingSecret: null,
    twoFactorEnforced: false,
    ...overrides.user,
  };

  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    backupCode: {
      // Default: the supplied code matches nothing.
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 10 }),
    },
    $transaction: jest.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops as Promise<unknown>[]) : (ops as any)(prisma),
    ),
  } as unknown as PrismaService;

  const crypto = {
    encrypt: jest.fn((v: string) => `enc:${v}`),
    decrypt: jest.fn(() => 'PLAINSECRET'),
    sha256: jest.fn((v: string) => `sha:${v}`),
    normalizeBackupCode: jest.fn((v: string) => v.trim().toUpperCase()),
    generateBackupCodes: jest.fn(() => Array.from({ length: 10 }, (_, i) => `CODE${i}`)),
    ...overrides.crypto,
  } as unknown as CryptoService;

  const config = {
    get: jest.fn().mockReturnValue({ issuer: 'Wizer Signage' }),
  } as unknown as ConfigService;

  const password = {
    verify: jest.fn().mockResolvedValue(overrides.passwordValid ?? true),
  } as unknown as PasswordService;

  const users = {
    isBlocked: jest.fn().mockReturnValue(overrides.blocked ?? false),
    recordFailedLogin: jest.fn().mockResolvedValue({ locked: false }),
  } as unknown as UsersService;

  return {
    service: new TwoFactorService(prisma, crypto, password, users, config),
    prisma,
    crypto,
    password,
    users,
    user,
  };
}

describe('requiresTwoFactor', () => {
  it('always requires it for a Super Admin', () => {
    expect(requiresTwoFactor({ role: UserRole.SUPER_ADMIN, twoFactorEnforced: false })).toBe(true);
  });

  it('requires it for any role when enforced', () => {
    expect(requiresTwoFactor({ role: UserRole.VIEWER, twoFactorEnforced: true })).toBe(true);
  });

  it('does not require it for an ordinary unenforced user', () => {
    expect(requiresTwoFactor({ role: UserRole.VIEWER, twoFactorEnforced: false })).toBe(false);
  });
});

describe('TwoFactorService.verifyCodeForUser', () => {
  it('accepts a valid TOTP code', async () => {
    const { service } = build();
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
    await expect(service.verifyCodeForUser('u1', VALID_CODE)).resolves.toBe(true);
  });

  it('rejects when 2FA is not enabled', async () => {
    const { service } = build({ user: { twoFactorEnabled: false } });
    await expect(service.verifyCodeForUser('u1', VALID_CODE)).resolves.toBe(false);
  });

  it('rejects when no secret is stored', async () => {
    const { service } = build({ user: { twoFactorSecret: null } });
    await expect(service.verifyCodeForUser('u1', VALID_CODE)).resolves.toBe(false);
  });

  it('falls back to a backup code when the TOTP code does not match', async () => {
    const { service, prisma } = build();
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(false);
    (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
    (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    await expect(service.verifyCodeForUser('u1', 'BACKUP1')).resolves.toBe(true);
  });

  it('rejects a backup code another request already consumed', () => {
    // The claim is `updateMany ... where usedAt: null`; a count of 0 means a
    // concurrent request won the race, and a single-use code must not be
    // honoured twice.
    const { service, prisma } = build();
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(false);
    (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
    (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    return expect(service.verifyCodeForUser('u1', 'BACKUP1')).resolves.toBe(false);
  });

  describe('when the stored secret cannot be decrypted', () => {
    // The ENCRYPTION_KEY-rotation case. decrypt() throws on a GCM auth-tag
    // mismatch; if that propagates it escapes before the backup-code fallback,
    // and the only credential that could still admit an administrator becomes
    // unreachable — the platform is permanently unadministrable.
    const rotated = {
      crypto: {
        decrypt: jest.fn(() => {
          throw new Error('Unsupported state or unable to authenticate data');
        }),
      },
    };

    it('does not throw', async () => {
      const { service } = build(rotated);
      await expect(service.verifyCodeForUser('u1', VALID_CODE)).resolves.toBe(false);
    });

    it('leaves the backup-code path reachable', async () => {
      const { service, prisma } = build(rotated);
      (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
      (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(service.verifyCodeForUser('u1', 'BACKUP1')).resolves.toBe(true);
      expect(prisma.backupCode.updateMany).toHaveBeenCalled();
    });
  });
});

describe('TwoFactorService.enable', () => {
  it('refuses when enrollment was never started', async () => {
    const { service } = build({ user: { twoFactorPendingSecret: null } });
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
    await expect(service.enable('u1', VALID_CODE, PROOF)).rejects.toThrow(/Start 2FA setup/i);
  });

  it('refuses an invalid confirmation code', async () => {
    const { service } = build({ user: { twoFactorPendingSecret: 'enc:pending' } });
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(false);
    await expect(service.enable('u1', '000000', PROOF)).rejects.toThrow(UnauthorizedException);
  });

  it('issues backup codes on success', async () => {
    const { service, crypto } = build({ user: { twoFactorPendingSecret: 'enc:pending' } });
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);

    const result = await service.enable('u1', VALID_CODE, PROOF);
    expect(result.backupCodes).toHaveLength(10);
    expect(crypto.generateBackupCodes).toHaveBeenCalledWith(10);
  });
});

/**
 * Re-authentication on the 2FA management routes.
 *
 * The hole these close: a bearer token proved a session existed and nothing
 * more, so anyone holding a stolen one could enrol their own authenticator —
 * turning a borrowed session into access that survives the victim's password
 * reset — or, on an account that already had 2FA, silently replace the
 * authenticator and destroy the backup codes.
 */
describe('TwoFactorService re-authentication', () => {
  const noTwoFactor = { twoFactorEnabled: false, twoFactorSecret: null };

  describe('setup', () => {
    it('rejects a wrong password', async () => {
      const { service } = build({ user: noTwoFactor, passwordValid: false });
      await expect(service.setup('u1', { password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not write a pending secret when the password is wrong', async () => {
      // The disclosure half of the hole: a rejected call must not leave a
      // usable secret behind, nor overwrite an enrolment already in flight.
      const { service, prisma } = build({ user: noTwoFactor, passwordValid: false });
      await expect(service.setup('u1', { password: 'wrong' })).rejects.toThrow();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a user with no password set, rather than treating it as no password required', async () => {
      // passwordHash is nullable — a user is INVITED until they accept. Such a
      // user should have no session at all, but "no password set" must never
      // read as "anyone may proceed".
      const { service, password } = build({
        user: { ...noTwoFactor, passwordHash: null },
        passwordValid: true,
      });
      await expect(service.setup('u1', { password: 'anything' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(password.verify).not.toHaveBeenCalled();
    });

    it('proceeds with the right password when 2FA is not yet enabled', async () => {
      const { service, prisma } = build({ user: noTwoFactor });
      const result = await service.setup('u1', { password: PASSWORD });
      expect(result.secret).toEqual(expect.any(String));
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('demands a current code as well when 2FA is already enabled', async () => {
      // Password alone is one factor of two. Accepting it here would let a
      // leaked password replace the very factor that exists to survive one.
      const { service } = build();
      await expect(service.setup('u1', { password: PASSWORD })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts password + current code when 2FA is already enabled', async () => {
      const { service } = build();
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.setup('u1', PROOF)).resolves.toEqual(
        expect.objectContaining({ secret: expect.any(String) }),
      );
    });

    it('accepts a backup code as the current code', async () => {
      const { service, prisma } = build();
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(false);
      (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
      (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(
        service.setup('u1', { password: PASSWORD, currentCode: 'BACKUP1' }),
      ).resolves.toBeDefined();
    });

    it('reaches backup codes even when the stored secret is missing', async () => {
      // verifyCodeForUser returns early when twoFactorSecret is null, which
      // would put backup codes out of reach in exactly the state where they are
      // the only credential left. reauthenticate must not route through it.
      const { service, prisma } = build({ user: { twoFactorSecret: null } });
      (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
      (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(
        service.setup('u1', { password: PASSWORD, currentCode: 'BACKUP1' }),
      ).resolves.toBeDefined();
    });
  });

  describe('enable', () => {
    const pending = { twoFactorPendingSecret: 'enc:pending' };

    it('rejects a wrong password even with a valid confirmation code', async () => {
      const { service } = build({
        user: { ...noTwoFactor, ...pending },
        passwordValid: false,
      });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.enable('u1', VALID_CODE, { password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not promote the secret or reissue backup codes when the password is wrong', async () => {
      const { service, prisma } = build({
        user: { ...noTwoFactor, ...pending },
        passwordValid: false,
      });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.enable('u1', VALID_CODE, { password: 'wrong' })).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.backupCode.deleteMany).not.toHaveBeenCalled();
    });

    it('demands the current code when re-enrolling over existing 2FA', async () => {
      // Re-enrolment destroys the live authenticator and every backup code. It
      // must cost more than the password.
      const { service } = build({ user: pending });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.enable('u1', VALID_CODE, { password: PASSWORD })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses before re-auth when no enrolment is pending, so no backup code is burned', async () => {
      const { service, prisma, password } = build({ user: { twoFactorPendingSecret: null } });
      await expect(service.enable('u1', VALID_CODE, PROOF)).rejects.toThrow(/Start 2FA setup/i);
      expect(prisma.backupCode.updateMany).not.toHaveBeenCalled();
      expect(password.verify).not.toHaveBeenCalled();
    });

    it('stands on its own proof rather than assuming setup was gated', async () => {
      // A pending secret is not evidence that this caller created it.
      const { service, users } = build({ user: pending, passwordValid: false });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.enable('u1', VALID_CODE, PROOF)).rejects.toThrow();
      expect(users.recordFailedLogin).toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    const removable = { role: UserRole.VIEWER, twoFactorEnforced: false };

    it('now requires the password, not just a code', async () => {
      const { service } = build({ user: removable, passwordValid: false });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await expect(service.disable('u1', VALID_CODE, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('succeeds with both factors', async () => {
      const { service, prisma } = build({ user: removable });
      jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);
      await service.disable('u1', VALID_CODE, PASSWORD);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('refuses before re-auth when 2FA is mandatory, so no backup code is burned', async () => {
      const { service, prisma, password } = build({ user: { role: UserRole.SUPER_ADMIN } });
      await expect(service.disable('u1', 'BACKUP1', PASSWORD)).rejects.toThrow(/mandatory/i);
      expect(prisma.backupCode.updateMany).not.toHaveBeenCalled();
      expect(password.verify).not.toHaveBeenCalled();
    });
  });

  describe('attempt accounting', () => {
    it('counts a failed attempt toward the account lockout', async () => {
      // The per-IP throttle resets every minute; without this an attacker with
      // a stolen token has an unlimited password oracle.
      const { service, users } = build({ user: noTwoFactor, passwordValid: false });
      await expect(service.setup('u1', { password: 'wrong' })).rejects.toThrow();
      expect(users.recordFailedLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    });

    it('reports a lock once the attempt crosses the threshold', async () => {
      const { service, users } = build({ user: noTwoFactor, passwordValid: false });
      (users.recordFailedLogin as jest.Mock).mockResolvedValue({ locked: true });
      await expect(service.setup('u1', { password: 'wrong' })).rejects.toThrow(/locked/i);
    });

    it('turns an already-locked account away before doing any password work', async () => {
      const { service, password, users } = build({ user: noTwoFactor, blocked: true });
      await expect(service.setup('u1', { password: PASSWORD })).rejects.toThrow(/locked/i);
      expect(password.verify).not.toHaveBeenCalled();
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
    });

    it('does not consume a backup code when the password was wrong', async () => {
      // Checking the second factor first would let an attacker burn a victim's
      // single-use codes without knowing the password at all.
      const { service, prisma } = build({ passwordValid: false });
      (prisma.backupCode.findFirst as jest.Mock).mockResolvedValue({ id: 'bc1' });
      (prisma.backupCode.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(
        service.setup('u1', { password: 'wrong', currentCode: 'BACKUP1' }),
      ).rejects.toThrow();
      expect(prisma.backupCode.updateMany).not.toHaveBeenCalled();
    });

    it('gives the same message whichever half of the proof was wrong', async () => {
      // Distinct messages would tell an attacker when a guessed password was
      // right, reducing a two-factor guess to two independent one-factor ones.
      const bad = build({ passwordValid: false });
      jest.spyOn(bad.service as any, 'verifyToken').mockReturnValue(true);
      const badPassword = await bad.service.setup('u1', PROOF).catch((e: Error) => e.message);

      const good = build({ passwordValid: true });
      jest.spyOn(good.service as any, 'verifyToken').mockReturnValue(false);
      const badCode = await good.service.setup('u1', PROOF).catch((e: Error) => e.message);

      expect(badPassword).toBe(badCode);
    });
  });
});

describe('TwoFactorService token format', () => {
  it.each([
    ['too short', '12345'],
    ['too long', '1234567'],
    ['non-numeric', 'abcdef'],
    ['empty', ''],
  ])('rejects a %s code before any crypto work', (_label, code) => {
    const { service, crypto } = build();
    expect((service as any).verifyToken('SECRET', code)).toBe(false);
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it('tolerates spacing, as authenticator apps display it', () => {
    const { service } = build();
    // "123 456" is what the user sees on screen; rejecting it is a support call.
    expect(() => (service as any).verifyToken('SECRET', '123 456')).not.toThrow();
  });
});
