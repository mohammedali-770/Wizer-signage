import { BadRequestException } from '@nestjs/common';

import { EmailVerificationService } from './email-verification.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Single-use email confirmation for public trial signups.
 *
 * Two properties carry the security weight and both are asserted below:
 * the token is single-use and expiring (it is a bearer credential sitting in an
 * inbox), and `resend` is not an account-existence oracle (it is
 * unauthenticated, so any observable difference between "no such user",
 * "already verified" and "sent" is a free user-enumeration endpoint).
 */

function build() {
  const prisma = {
    emailVerificationToken: {
      findUnique: jest.fn(),
      create: jest.fn().mockReturnValue('create-op'),
      update: jest.fn().mockReturnValue('update-op'),
      updateMany: jest.fn().mockReturnValue('updateMany-op'),
    },
    user: { findUnique: jest.fn(), update: jest.fn().mockReturnValue('user-op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const crypto = {
    randomToken: jest.fn().mockReturnValue('raw-token'),
    // Hex, deliberately: a stub like `sha(${v})` would embed the raw token in
    // its own output and make the "never stores the token" assertion below pass
    // or fail for the wrong reason.
    sha256: jest.fn((v: string) => `h:${Buffer.from(v).toString('hex')}`),
  };
  const mail = { send: jest.fn().mockResolvedValue({ messageId: 'm1', live: true }) };
  const config = { get: jest.fn().mockReturnValue({ dashboardUrl: 'https://dash.test' }) };
  const service = new EmailVerificationService(
    prisma as any,
    crypto as any,
    mail as any,
    config as any,
  );
  return { service, prisma, crypto, mail };
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('EmailVerificationService.issue', () => {
  it('stores only the hash, never the token itself', async () => {
    const { service, prisma } = build();
    await service.issue('u1', 'a@b.test', 'Ada', 'en');

    const createArg = prisma.emailVerificationToken.create.mock.calls[0][0];
    expect(createArg.data.tokenHash).toBe(`h:${Buffer.from('raw-token').toString('hex')}`);
    expect(JSON.stringify(createArg)).not.toContain('raw-token');
  });

  it('emails a link carrying the RAW token', async () => {
    const { service, mail } = build();
    await service.issue('u1', 'a@b.test', 'Ada', 'en');

    const msg = mail.send.mock.calls[0][0];
    expect(msg.to).toBe('a@b.test');
    expect(msg.text).toContain('https://dash.test/en/verify-email?token=raw-token');
  });

  it('invalidates any outstanding token first', async () => {
    const { service, prisma } = build();
    await service.issue('u1', 'a@b.test', 'Ada', 'en');

    // Otherwise every resend leaves another working key in another inbox.
    const arg = prisma.emailVerificationToken.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ userId: 'u1', consumedAt: null });
    expect(arg.data.consumedAt).toBeInstanceOf(Date);
    // Both in ONE transaction, so a crash cannot revoke without reissuing.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates a mail failure instead of swallowing it', async () => {
    const { service, mail } = build();
    mail.send.mockRejectedValueOnce(new Error('smtp down'));
    // The caller turns this into a 503. Swallowing would strand an account that
    // can never log in, with nothing telling the user why.
    await expect(service.issue('u1', 'a@b.test', 'Ada', 'en')).rejects.toThrow('smtp down');
  });

  it('writes the Arabic link for an ar locale', async () => {
    const { service, mail } = build();
    await service.issue('u1', 'a@b.test', 'Ada', 'ar');
    expect(mail.send.mock.calls[0][0].text).toContain('https://dash.test/ar/verify-email?token=');
  });
});

describe('EmailVerificationService.confirm', () => {
  it('marks the address verified and consumes the token', async () => {
    const { service, prisma } = build();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: future(),
      consumedAt: null,
      user: { id: 'u1', email: 'a@b.test', emailVerifiedAt: null },
    });

    await expect(service.confirm('raw')).resolves.toEqual({ email: 'a@b.test' });

    expect(prisma.emailVerificationToken.update.mock.calls[0][0].data.consumedAt).toBeInstanceOf(
      Date,
    );
    expect(prisma.user.update.mock.calls[0][0].data.emailVerifiedAt).toBeInstanceOf(Date);
    // One transaction: never consume the token without verifying the user.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('looks the token up by hash, not by value', async () => {
    const { service, prisma } = build();
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
    await expect(service.confirm('raw')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.emailVerificationToken.findUnique.mock.calls[0][0].where.tokenHash).toBe(
      `h:${Buffer.from('raw').toString('hex')}`,
    );
  });

  it.each([
    ['unknown', null],
    [
      'already consumed',
      {
        id: 't1',
        userId: 'u1',
        expiresAt: future(),
        consumedAt: new Date(),
        user: { id: 'u1', email: 'a@b.test', emailVerifiedAt: null },
      },
    ],
    [
      'expired',
      {
        id: 't1',
        userId: 'u1',
        expiresAt: past(),
        consumedAt: null,
        user: { id: 'u1', email: 'a@b.test', emailVerifiedAt: null },
      },
    ],
  ])('rejects a %s token, and writes nothing', async (_label, record) => {
    const { service, prisma } = build();
    prisma.emailVerificationToken.findUnique.mockResolvedValue(record);
    await expect(service.confirm('raw')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('gives every failure the same message', async () => {
    const { service, prisma } = build();
    const messages: string[] = [];
    for (const record of [
      null,
      { id: 't', userId: 'u', expiresAt: future(), consumedAt: new Date(), user: {} },
      { id: 't', userId: 'u', expiresAt: past(), consumedAt: null, user: {} },
    ]) {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(record);
      await service.confirm('raw').catch((e: Error) => messages.push(e.message));
    }
    // Distinguishing expired from used from never-existed tells a guesser which
    // of those they hit.
    expect(new Set(messages).size).toBe(1);
  });

  it('does not move an already-verified timestamp', async () => {
    const { service, prisma } = build();
    const original = new Date('2020-01-01T00:00:00.000Z');
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: future(),
      consumedAt: null,
      user: { id: 'u1', email: 'a@b.test', emailVerifiedAt: original },
    });
    await service.confirm('raw');
    expect(prisma.user.update.mock.calls[0][0].data.emailVerifiedAt).toBe(original);
  });
});

describe('EmailVerificationService.resend', () => {
  it('is not an account-existence oracle', async () => {
    const { service, prisma, mail } = build();

    // Unknown address.
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.resend('nobody@b.test')).resolves.toBeUndefined();

    // Known but already verified.
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.test',
      name: 'Ada',
      locale: 'en',
      emailVerifiedAt: new Date(),
    });
    await expect(service.resend('a@b.test')).resolves.toBeUndefined();

    // Neither sent mail, and neither behaved differently from the outside.
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('resends for a known unverified address', async () => {
    const { service, prisma, mail } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.test',
      name: 'Ada',
      locale: 'en',
      emailVerifiedAt: null,
    });
    await service.resend('A@B.test');

    expect(prisma.user.findUnique.mock.calls[0][0].where.email).toBe('a@b.test');
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('still resolves when the mail send fails', async () => {
    const { service, prisma, mail } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.test',
      name: 'Ada',
      locale: 'en',
      emailVerifiedAt: null,
    });
    mail.send.mockRejectedValueOnce(new Error('smtp down'));
    // A thrown error here would be a status-code difference between "real
    // unverified account" and everything else — the oracle again.
    await expect(service.resend('a@b.test')).resolves.toBeUndefined();
  });
});
