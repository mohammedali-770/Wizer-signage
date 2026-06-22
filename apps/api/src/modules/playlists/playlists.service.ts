import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, ContentType, Orientation, PlaylistStatus, Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import {
  orientationProfile,
  type OrientationProfile,
} from '../../common/scheduling/orientation.util';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import type {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  DuplicatePlaylistDto,
  ListPlaylistsQueryDto,
  ReorderPlaylistItemsDto,
  UpdatePlaylistDto,
  UpdatePlaylistItemDto,
} from './dto/playlist.dto';

/** Fallback per-item dwell time when neither item nor content specifies one. */
export const DEFAULT_ITEM_DURATION_SECONDS = 10;

const PLAYLIST_INCLUDE = {
  items: {
    orderBy: { position: 'asc' as const },
    include: {
      content: {
        select: {
          id: true,
          type: true,
          title: true,
          orientation: true,
          status: true,
          expiresAt: true,
          deletedAt: true,
          durationSeconds: true,
          pageCount: true,
          mimeType: true,
        },
      },
    },
  },
} satisfies Prisma.PlaylistInclude;

type PlaylistWithItems = Prisma.PlaylistGetPayload<{ include: typeof PLAYLIST_INCLUDE }>;
type PlaylistItemRow = PlaylistWithItems['items'][number];

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // --- Create ------------------------------------------------------------

  async create(companyId: string, actor: AuthenticatedUser, dto: CreatePlaylistDto) {
    const items = dto.items ?? [];
    // Validate every initial item's content up front (same-company, ACTIVE, not expired).
    const contentById = await this.assertSelectableContentBatch(
      companyId,
      items.map((i) => i.contentId),
    );
    items.forEach((item) => this.assertItemDuration(contentById.get(item.contentId)!.type, item));

    const playlist = await this.prisma.playlist.create({
      data: {
        companyId,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? PlaylistStatus.ACTIVE,
        createdById: actor.userId,
        updatedById: actor.userId,
        items: items.length
          ? {
              create: items.map((item, index) => ({
                contentId: item.contentId,
                position: index,
                durationSeconds: item.durationSeconds ?? null,
                playFullVideo: item.playFullVideo ?? false,
                pdfPageDurationSeconds: item.pdfPageDurationSeconds ?? null,
                transitionType: item.transitionType ?? null,
                settings: (item.settings ?? {}) as Prisma.InputJsonValue,
              })),
            }
          : undefined,
      },
      include: PLAYLIST_INCLUDE,
    });
    await this.log(actor, companyId, 'playlist.created', playlist.id, {
      title: playlist.title,
      itemCount: items.length,
    });
    return this.toDetailView(playlist);
  }

  // --- Read --------------------------------------------------------------

  async list(companyId: string, query: ListPlaylistsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.PlaylistWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) where.createdAt.gte = new Date(query.createdFrom);
      if (query.createdTo) where.createdAt.lte = new Date(query.createdTo);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.playlist.findMany({
        where,
        orderBy: this.orderBy(query.sort),
        skip,
        take,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.playlist.count({ where }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id,
        companyId: p.companyId,
        title: p.title,
        description: p.description,
        status: p.status,
        itemCount: p._count.items,
        createdById: p.createdById,
        updatedById: p.updatedById,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        archivedAt: p.archivedAt,
      })),
      meta: meta(total),
    };
  }

  async getScopedOrThrow(companyId: string, id: string): Promise<PlaylistWithItems> {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id, companyId, deletedAt: null },
      include: PLAYLIST_INCLUDE,
    });
    if (!playlist) throw new NotFoundException('Playlist not found.');
    return playlist;
  }

  async getDetail(companyId: string, id: string) {
    return this.toDetailView(await this.getScopedOrThrow(companyId, id));
  }

  /** Validation summary for the builder + before scheduling. */
  async validate(companyId: string, id: string) {
    const view = this.toDetailView(await this.getScopedOrThrow(companyId, id));
    return {
      id: view.id,
      valid: view.schedulable,
      schedulable: view.schedulable,
      itemCount: view.itemCount,
      validItemCount: view.validItemCount,
      invalidItemCount: view.invalidItemCount,
      orientationProfile: view.orientationProfile,
      totalDurationSeconds: view.totalDurationSeconds,
      issues: view.items
        .filter((i) => !i.valid)
        .map((i) => ({ itemId: i.id, contentTitle: i.content?.title ?? null, issue: i.issue })),
      warnings: view.warnings,
    };
  }

  // --- Update / lifecycle ------------------------------------------------

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdatePlaylistDto) {
    await this.getScopedOrThrow(companyId, id);
    const data: Prisma.PlaylistUpdateInput = { updatedById: actor.userId };
    const changed: string[] = [];
    if (dto.title !== undefined) {
      data.title = dto.title;
      changed.push('title');
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
      changed.push('description');
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.archivedAt = null; // ACTIVE/DRAFT both clear the archive marker
      changed.push('status');
    }
    const playlist = await this.prisma.playlist.update({
      where: { id },
      data,
      include: PLAYLIST_INCLUDE,
    });
    await this.log(actor, companyId, 'playlist.updated', id, { changes: changed });
    return this.toDetailView(playlist);
  }

  async setArchived(companyId: string, actor: AuthenticatedUser, id: string, archived: boolean) {
    await this.getScopedOrThrow(companyId, id);
    const playlist = await this.prisma.playlist.update({
      where: { id },
      data: {
        status: archived ? PlaylistStatus.ARCHIVED : PlaylistStatus.ACTIVE,
        archivedAt: archived ? new Date() : null,
        updatedById: actor.userId,
      },
      include: PLAYLIST_INCLUDE,
    });
    await this.log(actor, companyId, archived ? 'playlist.archived' : 'playlist.unarchived', id);
    return this.toDetailView(playlist);
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.playlist.update({
      where: { id },
      data: { deletedAt: new Date(), status: PlaylistStatus.ARCHIVED, updatedById: actor.userId },
    });
    await this.log(actor, companyId, 'playlist.deleted', id);
    return { deleted: true };
  }

  async duplicate(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: DuplicatePlaylistDto,
  ) {
    const source = await this.getScopedOrThrow(companyId, id);
    // Only copy items whose content is still selectable (ACTIVE, non-expired) — the
    // same add-time rule used by create/addItem, so a duplicate never starts with
    // invalid references. Positions are re-indexed to stay contiguous.
    const selectable = await this.prisma.content.findMany({
      where: {
        id: { in: [...new Set(source.items.map((i) => i.contentId))] },
        companyId,
        deletedAt: null,
        status: ContentStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    const ok = new Set(selectable.map((c) => c.id));
    const items = source.items.filter((i) => ok.has(i.contentId));

    const copy = await this.prisma.playlist.create({
      data: {
        companyId,
        title: dto.title?.trim() || `${source.title} (copy)`,
        description: source.description,
        status: PlaylistStatus.ACTIVE,
        createdById: actor.userId,
        updatedById: actor.userId,
        items: {
          create: items.map((item, index) => ({
            contentId: item.contentId,
            position: index,
            durationSeconds: item.durationSeconds,
            playFullVideo: item.playFullVideo,
            pdfPageDurationSeconds: item.pdfPageDurationSeconds,
            transitionType: item.transitionType,
            settings: item.settings as Prisma.InputJsonValue,
          })),
        },
      },
      include: PLAYLIST_INCLUDE,
    });
    await this.log(actor, companyId, 'playlist.duplicated', copy.id, {
      sourceId: id,
      copiedItems: items.length,
      skippedItems: source.items.length - items.length,
    });
    return this.toDetailView(copy);
  }

  // --- Items -------------------------------------------------------------

  async addItem(
    companyId: string,
    actor: AuthenticatedUser,
    playlistId: string,
    dto: AddPlaylistItemDto,
  ) {
    const playlist = await this.getScopedOrThrow(companyId, playlistId);
    this.assertEditable(playlist);
    const content = await this.assertSelectableContent(companyId, dto.contentId);
    this.assertItemDuration(content.type, dto);

    const count = playlist.items.length;
    const insertAt = dto.position != null ? Math.min(dto.position, count) : count;

    await this.prisma.$transaction(async (tx) => {
      if (insertAt < count) {
        // Shift trailing items down to make room (descending to avoid unique clashes).
        for (const item of [...playlist.items].reverse()) {
          if (item.position >= insertAt) {
            await tx.playlistItem.update({
              where: { id: item.id },
              data: { position: item.position + 1 },
            });
          }
        }
      }
      await tx.playlistItem.create({
        data: {
          playlistId,
          contentId: dto.contentId,
          position: insertAt,
          durationSeconds: dto.durationSeconds ?? null,
          playFullVideo: dto.playFullVideo ?? false,
          pdfPageDurationSeconds: dto.pdfPageDurationSeconds ?? null,
          transitionType: dto.transitionType ?? null,
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
        },
      });
      await tx.playlist.update({ where: { id: playlistId }, data: { updatedById: actor.userId } });
    });
    await this.log(actor, companyId, 'playlist.item_added', playlistId, {
      contentId: dto.contentId,
    });
    return this.getDetail(companyId, playlistId);
  }

  async updateItem(
    companyId: string,
    actor: AuthenticatedUser,
    playlistId: string,
    itemId: string,
    dto: UpdatePlaylistItemDto,
  ) {
    const playlist = await this.getScopedOrThrow(companyId, playlistId);
    this.assertEditable(playlist);
    const item = playlist.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Playlist item not found.');

    // Re-validate the duration against the effective playFullVideo flag.
    const playFullVideo = dto.playFullVideo ?? item.playFullVideo;
    const durationSeconds = dto.durationSeconds ?? item.durationSeconds ?? undefined;
    this.assertItemDuration(item.content.type, { playFullVideo, durationSeconds });

    const data: Prisma.PlaylistItemUpdateInput = {};
    if (dto.durationSeconds !== undefined) data.durationSeconds = dto.durationSeconds;
    if (dto.playFullVideo !== undefined) data.playFullVideo = dto.playFullVideo;
    if (dto.pdfPageDurationSeconds !== undefined)
      data.pdfPageDurationSeconds = dto.pdfPageDurationSeconds;
    if (dto.transitionType !== undefined) data.transitionType = dto.transitionType;
    if (dto.settings !== undefined) data.settings = dto.settings as Prisma.InputJsonValue;

    await this.prisma.$transaction([
      this.prisma.playlistItem.update({ where: { id: itemId }, data }),
      this.prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedById: actor.userId },
      }),
    ]);
    await this.log(actor, companyId, 'playlist.item_updated', playlistId, { itemId });
    return this.getDetail(companyId, playlistId);
  }

  async removeItem(
    companyId: string,
    actor: AuthenticatedUser,
    playlistId: string,
    itemId: string,
  ) {
    const playlist = await this.getScopedOrThrow(companyId, playlistId);
    this.assertEditable(playlist);
    if (!playlist.items.some((i) => i.id === itemId)) {
      throw new NotFoundException('Playlist item not found.');
    }
    // Delete then re-compact positions to keep them contiguous (0..n-1).
    const remaining = playlist.items.filter((i) => i.id !== itemId);
    await this.prisma.$transaction([
      this.prisma.playlistItem.delete({ where: { id: itemId } }),
      ...remaining.map((item, index) =>
        this.prisma.playlistItem.update({ where: { id: item.id }, data: { position: index } }),
      ),
      this.prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedById: actor.userId },
      }),
    ]);
    await this.log(actor, companyId, 'playlist.item_removed', playlistId, { itemId });
    return this.getDetail(companyId, playlistId);
  }

  async reorderItems(
    companyId: string,
    actor: AuthenticatedUser,
    playlistId: string,
    dto: ReorderPlaylistItemsDto,
  ) {
    const playlist = await this.getScopedOrThrow(companyId, playlistId);
    this.assertEditable(playlist);
    const current = new Set(playlist.items.map((i) => i.id));
    const next = dto.itemIds;
    if (
      next.length !== current.size ||
      new Set(next).size !== next.length ||
      next.some((id) => !current.has(id))
    ) {
      throw new BadRequestException('Reorder must list every playlist item exactly once.');
    }
    await this.prisma.$transaction([
      ...next.map((id, index) =>
        this.prisma.playlistItem.update({ where: { id }, data: { position: index } }),
      ),
      this.prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedById: actor.userId },
      }),
    ]);
    await this.log(actor, companyId, 'playlist.items_reordered', playlistId, {
      count: next.length,
    });
    return this.getDetail(companyId, playlistId);
  }

  // --- Helpers -----------------------------------------------------------

  private assertEditable(playlist: PlaylistWithItems): void {
    if (playlist.status === PlaylistStatus.ARCHIVED) {
      throw new BadRequestException('Unarchive the playlist before editing its items.');
    }
  }

  /** A content item is selectable when same-company, ACTIVE, not expired, not deleted. */
  private async assertSelectableContent(companyId: string, contentId: string) {
    const content = await this.prisma.content.findFirst({
      where: { id: contentId, companyId, deletedAt: null },
      select: { id: true, type: true, status: true, expiresAt: true },
    });
    if (!content || content.status !== ContentStatus.ACTIVE) {
      throw new BadRequestException('Content must be an active item in your company.');
    }
    if (content.expiresAt && content.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Expired content cannot be added to a playlist.');
    }
    return content;
  }

  private async assertSelectableContentBatch(companyId: string, contentIds: string[]) {
    const map = new Map<string, { id: string; type: ContentType }>();
    for (const id of [...new Set(contentIds)]) {
      const content = await this.assertSelectableContent(companyId, id);
      map.set(id, { id: content.id, type: content.type });
    }
    return map;
  }

  /** Enforce the per-type duration rules (videos need a duration or full-play). */
  private assertItemDuration(
    type: ContentType,
    item: { playFullVideo?: boolean | null; durationSeconds?: number | null },
  ): void {
    if (type === ContentType.VIDEO) {
      if (!item.playFullVideo && (item.durationSeconds == null || item.durationSeconds < 1)) {
        throw new BadRequestException(
          'Video items require playFullVideo = true or a durationSeconds ≥ 1.',
        );
      }
      return;
    }
    if (item.durationSeconds != null && item.durationSeconds < 1) {
      throw new BadRequestException('Item durationSeconds must be ≥ 1 second.');
    }
  }

  private orderBy(sort?: string): Prisma.PlaylistOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'title':
        return { title: 'asc' };
      case 'updated':
        return { updatedAt: 'desc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  /** Effective dwell time for an item (used for the total-duration estimate). */
  private itemDuration(item: PlaylistItemRow): number {
    const { content } = item;
    if (content.type === ContentType.VIDEO && item.playFullVideo) {
      // Full-length playback ignores the per-item duration (0 ⇒ unknown/natural end).
      return content.durationSeconds ?? 0;
    }
    if (content.type === ContentType.PDF && item.pdfPageDurationSeconds) {
      return item.pdfPageDurationSeconds * (content.pageCount ?? 1);
    }
    return item.durationSeconds ?? content.durationSeconds ?? DEFAULT_ITEM_DURATION_SECONDS;
  }

  /** Validity of a single item's content at read time. */
  private itemIssue(item: PlaylistItemRow): string | null {
    const { content } = item;
    if (!content || content.deletedAt || content.status === ContentStatus.DELETED)
      return 'Content was deleted.';
    if (content.status === ContentStatus.TRASH) return 'Content is in the trash.';
    if (content.status === ContentStatus.ARCHIVED) return 'Content is archived.';
    if (content.expiresAt && content.expiresAt.getTime() <= Date.now())
      return 'Content has expired.';
    return null;
  }

  private toDetailView(playlist: PlaylistWithItems) {
    const items = playlist.items.map((item) => {
      const issue = this.itemIssue(item);
      return {
        id: item.id,
        contentId: item.contentId,
        position: item.position,
        durationSeconds: item.durationSeconds,
        playFullVideo: item.playFullVideo,
        pdfPageDurationSeconds: item.pdfPageDurationSeconds,
        transitionType: item.transitionType,
        settings: item.settings,
        effectiveDurationSeconds: this.itemDuration(item),
        valid: issue === null,
        issue,
        content: {
          id: item.content.id,
          type: item.content.type,
          title: item.content.title,
          orientation: item.content.orientation,
          status: item.content.status,
          expiresAt: item.content.expiresAt,
          isExpired: !!item.content.expiresAt && item.content.expiresAt.getTime() <= Date.now(),
        },
      };
    });
    const validItems = items.filter((i) => i.valid);
    const profile: OrientationProfile = orientationProfile(
      validItems.map((i) => i.content.orientation as Orientation),
    );
    const warnings: string[] = [];
    const invalidCount = items.length - validItems.length;
    if (invalidCount > 0) {
      warnings.push(
        `${invalidCount} item(s) reference content that is expired, archived, trashed, or deleted.`,
      );
    }
    if (items.length > 0 && validItems.length === 0) {
      warnings.push(
        'No valid items — this playlist cannot be scheduled until at least one item is playable.',
      );
    }

    return {
      id: playlist.id,
      companyId: playlist.companyId,
      title: playlist.title,
      description: playlist.description,
      status: playlist.status,
      createdById: playlist.createdById,
      updatedById: playlist.updatedById,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      archivedAt: playlist.archivedAt,
      items,
      itemCount: items.length,
      validItemCount: validItems.length,
      invalidItemCount: invalidCount,
      totalDurationSeconds: validItems.reduce((sum, i) => sum + i.effectiveDurationSeconds, 0),
      orientationProfile: profile,
      schedulable: validItems.length >= 1 && playlist.status === PlaylistStatus.ACTIVE,
      warnings,
    };
  }

  private log(
    actor: AuthenticatedUser,
    companyId: string,
    action: string,
    targetId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.activityLog.log({
      action,
      category: ActivityCategory.COMPANY,
      actorId: actor.userId,
      companyId,
      targetType: 'playlist',
      targetId,
      metadata,
    });
  }
}
