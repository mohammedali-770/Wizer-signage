import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { IMPERSONATION_TTL_MINUTES, ImpersonationService } from './impersonation.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function build() {
  const prisma: any = {
    company: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' }) },
    session: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  };
  const sessions = { revoke: jest.fn().mockResolvedValue(undefined) };
  const twoFactor = { verifyCodeForUser: jest.fn().mockResolvedValue(true) };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const crypto = { sha256: jest.fn((v: string) => `sha:${v}`) };
  const jwt = { signAsync: jest.fn().mockResolvedValue('impersonation.jwt') };
  const config = { get: () => ({ accessSecret: 'a'.repeat(32) }) };

  const service = new ImpersonationService(
    prisma,
    sessions as any,
    twoFactor as any,
    activityLog as any,
    crypto as any,
    jwt as any,
    config as any,
  );
  return { service, prisma, sessions, twoFactor, activityLog, jwt };
}

const admin: any = {
  userId: 'admin-1',
  email: 'admin@wizer.test',
  role: 'SUPER_ADMIN',
  companyId: null,
  sessionId: 'admin-session',
  isSuperAdmin: true,
  mfaSatisfied: true,
  twoFactorRequired: true,
  impersonatorId: null,
};
const meta = { ip: '10.0.0.1', userAgent: 'jest' };
const dto = {
  companyId: 'c1',
  twoFactorCode: '123456',
  reason: 'Ticket 4821: playlist not syncing',
};

describe('ImpersonationService.start', () => {
  it('requires a fresh two-factor code, not merely a 2FA-satisfied session', async () => {
    const t = build();
    t.twoFactor.verifyCodeForUser.mockResolvedValue(false);

    // The admin's session already has mfaSatisfied: true — that must not be enough.
    await expect(t.service.start(admin, dto, meta)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.prisma.session.create).not.toHaveBeenCalled();
  });

  it('logs a denied attempt so brute force is visible in the audit trail', async () => {
    const t = build();
    t.twoFactor.verifyCodeForUser.mockResolvedValue(false);
    await t.service.start(admin, dto, meta).catch(() => undefined);

    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'superadmin.impersonation_denied' }),
    );
  });

  it('refuses a non-super-admin outright', async () => {
    const t = build();
    await expect(
      t.service.start({ ...admin, isSuperAdmin: false }, dto, meta),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.twoFactor.verifyCodeForUser).not.toHaveBeenCalled();
  });

  it('refuses to nest one impersonation inside another', async () => {
    const t = build();
    await expect(
      t.service.start({ ...admin, impersonatorId: 'admin-1' }, dto, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a deleted or unknown company', async () => {
    const t = build();
    t.prisma.company.findFirst.mockResolvedValue(null);
    await expect(t.service.start(admin, dto, meta)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.session.create).not.toHaveBeenCalled();
  });

  it('creates a separate session tagged with the impersonator and the reason', async () => {
    const t = build();
    await t.service.start(admin, dto, meta);

    const data = t.prisma.session.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'admin-1',
      companyId: 'c1',
      impersonatorId: 'admin-1',
      impersonationNote: dto.reason,
      mfaSatisfied: true,
    });
    // The admin's OWN session is untouched, so ending impersonation cannot log
    // them out of the platform console.
    expect(data.id).not.toBe(admin.sessionId);
  });

  it('issues no refresh token — an impersonation expires, it cannot be extended', async () => {
    const t = build();
    const out: any = await t.service.start(admin, dto, meta);
    expect(out.refreshToken).toBeUndefined();
    expect(out.accessToken).toBe('impersonation.jwt');
  });

  it('stores an unguessable refresh hash so no token can ever match the session', async () => {
    const t = build();
    await t.service.start(admin, dto, meta);
    const hash = t.prisma.session.create.mock.calls[0][0].data.refreshTokenHash;
    expect(hash).toMatch(/^sha:[0-9a-f-]{36}$/);
  });

  it('bounds the session and the token to the same short lifetime', async () => {
    const t = build();
    const before = Date.now();
    const out: any = await t.service.start(admin, dto, meta);

    const expiresAt = t.prisma.session.create.mock.calls[0][0].data.expiresAt as Date;
    const expectedMs = IMPERSONATION_TTL_MINUTES * 60_000;
    expect(expiresAt.getTime() - before).toBeGreaterThan(expectedMs - 5_000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(expectedMs + 5_000);
    expect(out.expiresAt).toBe(expiresAt.toISOString());
    expect(t.jwt.signAsync.mock.calls[0][1].expiresIn).toBe(`${IMPERSONATION_TTL_MINUTES}m`);
  });

  it('scopes the token to the target company and marks it as impersonation', async () => {
    const t = build();
    await t.service.start(admin, dto, meta);
    expect(t.jwt.signAsync.mock.calls[0][0]).toMatchObject({
      sub: 'admin-1',
      cid: 'c1',
      imp: 'admin-1',
      typ: 'access',
    });
  });

  it('records the start in BOTH the tenant and the platform audit trails', async () => {
    const t = build();
    await t.service.start(admin, dto, meta);

    const starts = t.activityLog.log.mock.calls
      .map((c: any[]) => c[0])
      .filter((e: any) => e.action === 'superadmin.impersonation_started');
    expect(starts).toHaveLength(2);
    expect(new Set(starts.map((e: any) => e.companyId))).toEqual(new Set([null, 'c1']));
    for (const entry of starts) expect(entry.metadata.reason).toBe(dto.reason);
  });
});

describe('ImpersonationService.end', () => {
  it('revokes the impersonation session and logs it', async () => {
    const t = build();
    const impersonating = {
      ...admin,
      companyId: 'c1',
      sessionId: 'imp-session',
      impersonatorId: 'admin-1',
    };

    await expect(t.service.end(impersonating, meta)).resolves.toEqual({ success: true });
    expect(t.sessions.revoke).toHaveBeenCalledWith('imp-session', 'impersonation_ended');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'superadmin.impersonation_ended', companyId: 'c1' }),
    );
  });

  it('refuses when the caller is not impersonating — never revokes a real session', async () => {
    const t = build();
    await expect(t.service.end(admin, meta)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.sessions.revoke).not.toHaveBeenCalled();
  });
});

describe('ImpersonationService.listActive', () => {
  it('asks only for sessions that are live right now', async () => {
    const t = build();
    await t.service.listActive();

    const where = t.prisma.session.findMany.mock.calls[0][0].where;
    expect(where.impersonatorId).toEqual({ not: null });
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('returns who was in which tenant, why, and until when', async () => {
    const t = build();
    const started = new Date('2026-08-03T10:00:00.000Z');
    const expires = new Date('2026-08-03T10:30:00.000Z');
    t.prisma.session.findMany.mockResolvedValue([
      {
        id: 'imp-1',
        impersonatorId: 'admin-1',
        impersonationNote: 'Ticket 4821',
        companyId: 'c1',
        createdAt: started,
        expiresAt: expires,
        ip: '10.0.0.1',
        company: { name: 'Acme' },
        user: { email: 'admin@wizer.test', name: 'Admin' },
      },
    ]);

    await expect(t.service.listActive()).resolves.toEqual([
      {
        sessionId: 'imp-1',
        adminId: 'admin-1',
        adminEmail: 'admin@wizer.test',
        companyId: 'c1',
        companyName: 'Acme',
        reason: 'Ticket 4821',
        startedAt: started.toISOString(),
        expiresAt: expires.toISOString(),
        ip: '10.0.0.1',
      },
    ]);
  });
});
