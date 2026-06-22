import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ContentService } from './content.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONTENT_ROW = {
  id: 'c1',
  companyId: 'comp1',
  type: 'IMAGE',
  status: 'ACTIVE',
  expiresAt: null,
  storageKey: 'k',
  checksum: 'x',
  meta: {},
  fileSize: BigInt(1000),
  tags: [],
};

function build() {
  const prisma: any = {
    content: {
      create: jest.fn().mockResolvedValue({ ...CONTENT_ROW }),
      findFirst: jest.fn().mockResolvedValue({ ...CONTENT_ROW }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) => Promise.resolve({ ...CONTENT_ROW, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    tag: { findMany: jest.fn() },
    contentTag: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const usageLimits = {
    assertFileSize: jest.fn().mockResolvedValue(undefined),
    assertCanAdd: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(),
  };
  const storage = {
    buildKey: jest.fn((c: string, id: string, fn: string) => `companies/${c}/content/${id}/${fn}`),
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const crypto = { sha256Buffer: jest.fn(() => 'checksum') };
  const service = new ContentService(
    prisma,
    activityLog as any,
    usageLimits as any,
    storage as any,
    crypto as any,
  );
  return { service, prisma, activityLog, usageLimits, storage };
}

const actor: any = { userId: 'u1', isSuperAdmin: false, companyId: 'comp1', role: 'COMPANY_ADMIN' };
// Real magic bytes so server-side detection (not the claimed MIME) accepts it.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n%binarymarker\n');
const imageFile = { buffer: PNG_BYTES, mimetype: 'image/png', originalname: 'a.png', size: 1000 };

describe('ContentService.upload', () => {
  it('uploads an image, enforces file size + storage, and logs', async () => {
    const t = build();
    await t.service.upload('comp1', actor, imageFile as any, { title: 'Banner' });
    expect(t.usageLimits.assertFileSize).toHaveBeenCalledWith('comp1', 1000);
    expect(t.usageLimits.assertCanAdd).toHaveBeenCalledWith(
      'comp1',
      'storageGb',
      expect.any(Number),
    );
    expect(t.storage.upload).toHaveBeenCalled();
    expect(t.prisma.content.create).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.uploaded' }),
    );
  });

  it('derives type/MIME from magic bytes, ignoring the client-claimed Content-Type', async () => {
    const t = build();
    // Claims octet-stream but the bytes are a real PNG.
    await t.service.upload(
      'comp1',
      actor,
      { ...imageFile, mimetype: 'application/octet-stream' } as any,
      { title: 'Banner' },
    );
    expect(t.storage.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      'image/png',
    );
    expect(t.prisma.content.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'IMAGE', mimeType: 'image/png' }),
      }),
    );
  });

  it('rejects an unsupported file type before touching storage', async () => {
    const t = build();
    // 'PK…' (zip) matches no allowlisted signature.
    await expect(
      t.service.upload(
        'comp1',
        actor,
        {
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          mimetype: 'image/png',
          originalname: 'a.png',
          size: 10,
        } as any,
        { title: 'x' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects when the real bytes and the extension disagree (PDF bytes, .png name)', async () => {
    const t = build();
    await expect(
      t.service.upload(
        'comp1',
        actor,
        { buffer: PDF_BYTES, mimetype: 'image/png', originalname: 'a.png', size: 10 } as any,
        { title: 'x' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('removes the uploaded object if the DB row fails (no orphaned storage)', async () => {
    const t = build();
    t.prisma.content.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      t.service.upload('comp1', actor, imageFile as any, { title: 'x' }),
    ).rejects.toThrow('db down');
    expect(t.storage.upload).toHaveBeenCalled();
    expect(t.storage.remove).toHaveBeenCalled();
  });

  it('blocks an over-size file (plan max file size)', async () => {
    const t = build();
    t.usageLimits.assertFileSize.mockRejectedValue(new ForbiddenException('too big'));
    await expect(
      t.service.upload('comp1', actor, imageFile as any, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('blocks when the storage limit/grace check rejects', async () => {
    const t = build();
    t.usageLimits.assertCanAdd.mockRejectedValue(new ForbiddenException('storage full'));
    await expect(
      t.service.upload('comp1', actor, imageFile as any, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });
});

describe('ContentService URL/text', () => {
  it('creates URL content and logs', async () => {
    const t = build();
    await t.service.createUrl('comp1', actor, { title: 'Site', url: 'https://example.com' });
    expect(t.prisma.content.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'URL', url: 'https://example.com' }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.url_created' }),
    );
  });

  it('creates text content and logs', async () => {
    const t = build();
    await t.service.createText('comp1', actor, { title: 'Notice', textBody: 'Hello' });
    expect(t.prisma.content.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'TEXT', textBody: 'Hello' }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.text_created' }),
    );
  });
});

describe('ContentService tags (CONTENT/BOTH only)', () => {
  it('allows a CONTENT/BOTH tag', async () => {
    const t = build();
    t.prisma.tag.findMany.mockResolvedValue([{ id: 'ct' }]);
    await expect(
      t.service.createUrl('comp1', actor, { title: 'x', url: 'https://e.com', tagIds: ['ct'] }),
    ).resolves.toBeDefined();
  });

  it('rejects a SCREEN-only tag (filtered out by the type query)', async () => {
    const t = build();
    t.prisma.tag.findMany.mockResolvedValue([]); // the SCREEN tag doesn't match CONTENT/BOTH
    await expect(
      t.service.createUrl('comp1', actor, {
        title: 'x',
        url: 'https://e.com',
        tagIds: ['screenTag'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContentService lifecycle & scoping', () => {
  it('returns 404 for content outside the tenant', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(null);
    await expect(t.service.getScopedOrThrow('comp1', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('trashes and restores with the right audit actions', async () => {
    const t = build();
    await t.service.setLifecycle('comp1', actor, 'c1', 'trash');
    expect(t.prisma.content.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TRASH', trashedAt: expect.any(Date) }),
      }),
    );
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.trashed' }),
    );

    await t.service.setLifecycle('comp1', actor, 'c1', 'restore');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.restored' }),
    );
  });

  it('archives and unarchives', async () => {
    const t = build();
    await t.service.setLifecycle('comp1', actor, 'c1', 'archive');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.archived' }),
    );
    await t.service.setLifecycle('comp1', actor, 'c1', 'unarchive');
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content.unarchived' }),
    );
  });
});

describe('ContentService.assertSelectableFallback', () => {
  it('accepts an ACTIVE same-company content item', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue({ id: 'c1' });
    await expect(t.service.assertSelectableFallback('comp1', 'c1')).resolves.toBeUndefined();
  });

  it('rejects a non-active / cross-tenant content item', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(null);
    await expect(t.service.assertSelectableFallback('comp1', 'archived')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
