import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    uploadFile: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  // The platform's own origins, as the self-origin guard reads them. Synthetic
  // hosts on the reserved example.com domain — never the deployed one.
  const config = {
    get: jest.fn(() => ({
      dashboardUrl: 'https://signage.example.com',
      apiUrl: 'https://api.signage.example.com',
    })),
  };
  const service = new ContentService(
    prisma,
    activityLog as any,
    usageLimits as any,
    storage as any,
    config as any,
  );
  return { service, prisma, config, activityLog, usageLimits, storage };
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

/**
 * Disk-spooled uploads. multer now writes the multipart body to disk instead of
 * holding it in the heap, so the service must (a) stream it to storage rather
 * than buffering it, and (b) delete the temp file on EVERY exit path — a client
 * that repeatedly sends rejected uploads must not be able to fill the disk.
 */
describe('ContentService.upload — disk-spooled files', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wizer-content-test-'));
  });

  async function spool(bytes: Buffer, originalname = 'a.png') {
    const path = join(dir, `${randomUUID()}.part`);
    await writeFile(path, bytes);
    return { path, mimetype: 'image/png', originalname, size: bytes.length };
  }

  it('streams the file to storage without ever buffering it', async () => {
    const t = build();
    const file = await spool(PNG_BYTES);
    await t.service.upload('comp1', actor, file as any, { title: 'Banner' });

    expect(t.storage.uploadFile).toHaveBeenCalledWith(expect.any(String), file.path, 'image/png');
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('records the real streaming SHA-256 of the file', async () => {
    const t = build();
    const bytes = Buffer.concat([PNG_BYTES, Buffer.alloc(4096, 0x7a)]);
    const file = await spool(bytes);
    await t.service.upload('comp1', actor, file as any, { title: 'Banner' });

    expect(t.prisma.content.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checksum: createHash('sha256').update(bytes).digest('hex'),
        }),
      }),
    );
  });

  it('deletes the temp file after a successful upload', async () => {
    const t = build();
    const file = await spool(PNG_BYTES);
    await t.service.upload('comp1', actor, file as any, { title: 'Banner' });
    expect(existsSync(file.path)).toBe(false);
  });

  it('deletes the temp file when the type is rejected', async () => {
    const t = build();
    const file = await spool(Buffer.from([0x50, 0x4b, 0x03, 0x04])); // zip
    await expect(
      t.service.upload('comp1', actor, file as any, { title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(file.path)).toBe(false);
  });

  it('deletes the temp file when a plan limit rejects', async () => {
    const t = build();
    t.usageLimits.assertFileSize.mockRejectedValue(new ForbiddenException('too big'));
    const file = await spool(PNG_BYTES);
    await expect(
      t.service.upload('comp1', actor, file as any, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(existsSync(file.path)).toBe(false);
  });

  it('deletes the temp file when the DB row fails', async () => {
    const t = build();
    t.prisma.content.create.mockRejectedValueOnce(new Error('db down'));
    const file = await spool(PNG_BYTES);
    await expect(t.service.upload('comp1', actor, file as any, { title: 'x' })).rejects.toThrow(
      'db down',
    );
    expect(existsSync(file.path)).toBe(false);
    expect(t.storage.remove).toHaveBeenCalled();
  });

  it('streams and cleans up on replaceFile too', async () => {
    const t = build();
    const file = await spool(PNG_BYTES);
    await t.service.replaceFile('comp1', actor, 'c1', file as any);
    expect(t.storage.uploadFile).toHaveBeenCalledWith(expect.any(String), file.path, 'image/png');
    expect(existsSync(file.path)).toBe(false);
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

/**
 * URL content is rendered in an iframe on the dashboard and a WebView on the
 * player. A tenant-supplied URL on the platform's OWN host makes that frame
 * same-origin with the viewer's authenticated session — a token-theft primitive
 * against whoever opens the preview, up to a Super Admin.
 *
 * The iframe sandbox is the other half of this defence. Both exist because
 * either one alone is a single edit away from being undone.
 */
describe('ContentService — self-origin URL content', () => {
  const SELF = 'https://signage.example.com/anything';
  const API_SELF = 'https://api.signage.example.com/api/health';

  it('creates URL content pointing somewhere external', async () => {
    const t = build();
    await expect(
      t.service.createUrl('comp1', actor, { title: 'Site', url: 'https://news.example.org/live' }),
    ).resolves.toBeDefined();
  });

  it('refuses URL content pointing at the dashboard origin', async () => {
    const t = build();
    await expect(t.service.createUrl('comp1', actor, { title: 'Evil', url: SELF })).rejects.toThrow(
      /cannot point at this platform/i,
    );
    expect(t.prisma.content.create).not.toHaveBeenCalled();
  });

  it('refuses URL content pointing at the API origin', async () => {
    const t = build();
    await expect(
      t.service.createUrl('comp1', actor, { title: 'Evil', url: API_SELF }),
    ).rejects.toThrow(/cannot point at this platform/i);
    expect(t.prisma.content.create).not.toHaveBeenCalled();
  });

  it('rejects BEFORE consuming a tag lookup or writing anything', async () => {
    // Ordering matters: a rejection that happens after the write is not a
    // rejection.
    const t = build();
    await expect(
      t.service.createUrl('comp1', actor, { title: 'Evil', url: SELF, tagIds: ['ct'] }),
    ).rejects.toThrow();
    expect(t.prisma.content.create).not.toHaveBeenCalled();
    expect(t.activityLog.log).not.toHaveBeenCalled();
  });

  it('refuses to EDIT existing URL content into a self-origin URL', async () => {
    // Create clean, edit dirty. Without the check on the update path the
    // create-time gate is trivially walked past.
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue({
      id: 'c1',
      companyId: 'comp1',
      type: 'URL',
      url: 'https://news.example.org/live',
      status: 'ACTIVE',
      deletedAt: null,
    });

    await expect(t.service.update('comp1', actor, 'c1', { url: SELF })).rejects.toThrow(
      /cannot point at this platform/i,
    );
    expect(t.prisma.content.update).not.toHaveBeenCalled();
  });

  it('still allows editing to another external URL', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue({
      id: 'c1',
      companyId: 'comp1',
      type: 'URL',
      url: 'https://news.example.org/live',
      status: 'ACTIVE',
      deletedAt: null,
    });

    await expect(
      t.service.update('comp1', actor, 'c1', { url: 'https://other.example.org/page' }),
    ).resolves.toBeDefined();
  });
});
