import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PlaylistsService } from './playlists.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const actor: any = { userId: 'u1', companyId: 'comp1', role: 'COMPANY_ADMIN' };

function content(over: any = {}) {
  return {
    id: 'c1',
    type: 'IMAGE',
    title: 'Banner',
    orientation: 'LANDSCAPE',
    status: 'ACTIVE',
    expiresAt: null,
    deletedAt: null,
    durationSeconds: null,
    pageCount: null,
    mimeType: 'image/png',
    ...over,
  };
}

function item(over: any = {}) {
  return {
    id: 'i1',
    contentId: 'c1',
    position: 0,
    durationSeconds: null,
    playFullVideo: false,
    pdfPageDurationSeconds: null,
    transitionType: null,
    settings: {},
    content: content(over.content ?? {}),
    ...over,
  };
}

function playlist(over: any = {}) {
  return {
    id: 'p1',
    companyId: 'comp1',
    title: 'Lobby loop',
    description: null,
    status: 'ACTIVE',
    createdById: 'u1',
    updatedById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    items: [],
    ...over,
  };
}

function build() {
  const prisma: any = {
    playlist: {
      create: jest.fn().mockResolvedValue(playlist()),
      findFirst: jest.fn().mockResolvedValue(playlist()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(playlist(data))),
    },
    playlistItem: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    content: {
      findFirst: jest.fn().mockResolvedValue(content()),
      findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
    },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new PlaylistsService(prisma, activityLog as any);
  return { service, prisma, activityLog };
}

describe('PlaylistsService create + scoping', () => {
  it('creates a playlist with validated items and logs', async () => {
    const t = build();
    t.prisma.playlist.create.mockResolvedValue(playlist({ items: [item()] }));
    await t.service.create('comp1', actor, { title: 'P', items: [{ contentId: 'c1' }] });
    expect(t.prisma.content.findFirst).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'playlist.created' }),
    );
  });

  it('returns 404 for a playlist outside the tenant', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(null);
    await expect(t.service.getDetail('comp1', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlaylistsService.addItem content validity', () => {
  it('rejects cross-company / missing content', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(null);
    await expect(
      t.service.addItem('comp1', actor, 'p1', { contentId: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects archived content', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(content({ status: 'ARCHIVED' }));
    await expect(t.service.addItem('comp1', actor, 'p1', { contentId: 'c1' })).rejects.toThrow(
      /active/i,
    );
  });

  it('rejects expired content', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(
      content({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(t.service.addItem('comp1', actor, 'p1', { contentId: 'c1' })).rejects.toThrow(
      /expired/i,
    );
  });

  it('rejects a video item with neither duration nor full-play', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(content({ type: 'VIDEO' }));
    await expect(t.service.addItem('comp1', actor, 'p1', { contentId: 'v1' })).rejects.toThrow(
      /video/i,
    );
  });

  it('accepts a video item with playFullVideo', async () => {
    const t = build();
    t.prisma.content.findFirst.mockResolvedValue(content({ type: 'VIDEO' }));
    t.prisma.playlist.findFirst.mockResolvedValue(playlist({ items: [] }));
    await t.service.addItem('comp1', actor, 'p1', { contentId: 'v1', playFullVideo: true });
    expect(t.prisma.playlistItem.create).toHaveBeenCalled();
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'playlist.item_added' }),
    );
  });

  it('cannot edit an archived playlist', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(playlist({ status: 'ARCHIVED' }));
    await expect(t.service.addItem('comp1', actor, 'p1', { contentId: 'c1' })).rejects.toThrow(
      /unarchive/i,
    );
  });
});

describe('PlaylistsService.reorderItems', () => {
  it('rejects a reorder that does not list every item exactly once', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(
      playlist({ items: [item({ id: 'i1' }), item({ id: 'i2', position: 1 })] }),
    );
    await expect(
      t.service.reorderItems('comp1', actor, 'p1', { itemIds: ['i1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reorders and logs when ids match', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(
      playlist({ items: [item({ id: 'i1' }), item({ id: 'i2', position: 1 })] }),
    );
    await t.service.reorderItems('comp1', actor, 'p1', { itemIds: ['i2', 'i1'] });
    expect(t.prisma.playlistItem.update).toHaveBeenCalledTimes(2);
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'playlist.items_reordered' }),
    );
  });
});

describe('PlaylistsService.duplicate', () => {
  it('copies only items whose content is still selectable, re-indexing positions', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(
      playlist({
        items: [
          item({ id: 'i1', contentId: 'c1' }),
          item({ id: 'i2', contentId: 'gone', position: 1 }),
        ],
      }),
    );
    // Only c1 is still ACTIVE / non-expired; 'gone' is filtered out.
    t.prisma.content.findMany.mockResolvedValue([{ id: 'c1' }]);
    await t.service.duplicate('comp1', actor, 'p1', {});
    const createArg = t.prisma.playlist.create.mock.calls[0][0];
    expect(createArg.data.items.create).toHaveLength(1);
    expect(createArg.data.items.create[0]).toMatchObject({ contentId: 'c1', position: 0 });
    expect(t.activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'playlist.duplicated',
        metadata: expect.objectContaining({ skippedItems: 1 }),
      }),
    );
  });
});

describe('PlaylistsService.validate', () => {
  it('is not schedulable when all items are invalid', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(
      playlist({ items: [item({ content: content({ status: 'ARCHIVED' }) })] }),
    );
    const result = await t.service.validate('comp1', 'p1');
    expect(result.schedulable).toBe(false);
    expect(result.invalidItemCount).toBe(1);
  });

  it('is schedulable with at least one valid item', async () => {
    const t = build();
    t.prisma.playlist.findFirst.mockResolvedValue(playlist({ items: [item()] }));
    const result = await t.service.validate('comp1', 'p1');
    expect(result.schedulable).toBe(true);
    expect(result.validItemCount).toBe(1);
  });
});
