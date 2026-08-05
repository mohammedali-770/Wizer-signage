import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';

import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TwoFactorService, requiresTwoFactor } from './two-factor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VALID_CODE = '123456';

function build(overrides: { user?: any; crypto?: Partial<CryptoService> } = {}) {
  const user = {
    id: 'u1',
    email: 'admin@example.com',
    role: UserRole.SUPER_ADMIN,
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

  return { service: new TwoFactorService(prisma, crypto, config), prisma, crypto, user };
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
    await expect(service.enable('u1', VALID_CODE)).rejects.toThrow(/Start 2FA setup/i);
  });

  it('refuses an invalid confirmation code', async () => {
    const { service } = build({ user: { twoFactorPendingSecret: 'enc:pending' } });
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(false);
    await expect(service.enable('u1', '000000')).rejects.toThrow(UnauthorizedException);
  });

  it('issues backup codes on success', async () => {
    const { service, crypto } = build({ user: { twoFactorPendingSecret: 'enc:pending' } });
    jest.spyOn(service as any, 'verifyToken').mockReturnValue(true);

    const result = await service.enable('u1', VALID_CODE);
    expect(result.backupCodes).toHaveLength(10);
    expect(crypto.generateBackupCodes).toHaveBeenCalledWith(10);
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
