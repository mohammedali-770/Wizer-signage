import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, ContentType, Orientation, Prisma, TagType } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { StorageService } from '../storage/storage.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type {
  BulkContentTagDto,
  CreateTextContentDto,
  CreateUrlContentDto,
  ListContentQueryDto,
  UpdateContentDto,
  UploadContentDto,
} from './dto/content.dto';

export const EXPIRING_SOON_DAYS = 7;

/** Allowed upload kinds — MIME + extension allowlists. */
const ALLOWED: Partial<Record<ContentType, { mimes: string[]; exts: string[] }>> = {
  IMAGE: {
    mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    exts: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  },
  VIDEO: {
    mimes: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    exts: ['mp4', 'webm', 'ogg', 'ogv', 'mov'],
  },
  PDF: { mimes: ['application/pdf'], exts: ['pdf'] },
};

const CONTENT_INCLUDE = {
  tags: { include: { tag: { select: { id: true, name: true, color: true, type: true } } } },
} satisfies Prisma.ContentInclude;

type ContentWithTags = Prisma.ContentGetPayload<{ include: typeof CONTENT_INCLUDE }>;
type MulterFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly usageLimits: UsageLimitsService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
  ) {}

  // --- Create ------------------------------------------------------------

  async upload(
    companyId: string,
    actor: AuthenticatedUser,
    file: MulterFile | undefined,
    dto: UploadContentDto,
  ) {
    if (!file) throw new BadRequestException('A file is required.');
    // Detect the real type from the file's magic bytes — never trust the
    // client-claimed Content-Type or filename for the allowlist.
    const detected = this.detectFileType(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Unsupported or unrecognized file. Allowed: images (PNG/JPEG/GIF/WEBP), videos (MP4/WEBM/OGG/MOV), PDF.',
      );
    }
    this.assertExtension(detected.type, file.originalname);

    // Per-file + total-storage plan enforcement (storage is grace-aware).
    await this.usageLimits.assertFileSize(companyId, file.size);
    await this.usageLimits.assertCanAdd(companyId, 'storageGb', file.size / 1_000_000_000);

    const tagIds = await this.validContentTags(companyId, this.parseTags(dto.tags));
    const contentId = randomUUID();
    const storageKey = this.storage.buildKey(companyId, contentId, file.originalname);
    await this.storage.upload(storageKey, file.buffer, detected.mime);

    let content: ContentWithTags;
    try {
      content = await this.prisma.content.create({
        data: {
          id: contentId,
          companyId,
          type: detected.type,
          title: dto.title,
          description: dto.description,
          storageKey,
          fileSize: BigInt(file.size),
          mimeType: detected.mime, // server-derived, not the client-claimed MIME
          originalFileName: file.originalname,
          checksum: this.crypto.sha256Buffer(file.buffer),
          orientation: dto.orientation ?? Orientation.UNKNOWN,
          durationSeconds: dto.durationSeconds,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          status: ContentStatus.ACTIVE,
          createdById: actor.userId,
          updatedById: actor.userId,
          tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
        include: CONTENT_INCLUDE,
      });
    } catch (error) {
      // Don't leak an orphaned (uncounted) storage object if the row fails.
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }

    await this.log(actor, companyId, 'content.uploaded', contentId, {
      title: dto.title,
      type: detected.type,
      fileSize: file.size,
    });
    return this.toView(content);
  }

  async createUrl(companyId: string, actor: AuthenticatedUser, dto: CreateUrlContentDto) {
    const tagIds = await this.validContentTags(companyId, dto.tagIds ?? []);
    const content = await this.prisma.content.create({
      data: {
        companyId,
        type: ContentType.URL,
        title: dto.title,
        description: dto.description,
        url: dto.url,
        orientation: dto.orientation ?? Orientation.UNKNOWN,
        durationSeconds: dto.durationSeconds ?? 15,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: actor.userId,
        updatedById: actor.userId,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
      include: CONTENT_INCLUDE,
    });
    await this.log(actor, companyId, 'content.url_created', content.id, {
      title: dto.title,
      url: dto.url,
    });
    return this.toView(content);
  }

  async createText(companyId: string, actor: AuthenticatedUser, dto: CreateTextContentDto) {
    const tagIds = await this.validContentTags(companyId, dto.tagIds ?? []);
    const content = await this.prisma.content.create({
      data: {
        companyId,
        type: ContentType.TEXT,
        title: dto.title,
        description: dto.description,
        textBody: dto.textBody,
        textStyle: (dto.textStyle ?? undefined) as Prisma.InputJsonValue | undefined,
        orientation: dto.orientation ?? Orientation.UNKNOWN,
        durationSeconds: dto.durationSeconds ?? 10,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: actor.userId,
        updatedById: actor.userId,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
      include: CONTENT_INCLUDE,
    });
    await this.log(actor, companyId, 'content.text_created', content.id, { title: dto.title });
    return this.toView(content);
  }

  // --- Read --------------------------------------------------------------

  async list(companyId: string, query: ListContentQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const now = new Date();
    const status =
      query.status && query.status !== ContentStatus.DELETED ? query.status : ContentStatus.ACTIVE;

    const where: Prisma.ContentWhereInput = { companyId, deletedAt: null, status };
    if (query.type) where.type = query.type;
    if (query.orientation) where.orientation = query.orientation;
    if (query.tagId) where.tags = { some: { tagId: query.tagId } };
    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) where.createdAt.gte = new Date(query.createdFrom);
      if (query.createdTo) where.createdAt.lte = new Date(query.createdTo);
    }

    const and: Prisma.ContentWhereInput[] = [];
    if (query.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { originalFileName: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.expiry === 'none') where.expiresAt = null;
    else if (query.expiry === 'expired') where.expiresAt = { lt: now };
    else if (query.expiry === 'expiring') {
      where.expiresAt = {
        gte: now,
        lte: new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000),
      };
    } else if (query.expiry === 'active') {
      and.push({ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
    }
    if (and.length) where.AND = and;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where,
        orderBy: this.orderBy(query.sort),
        skip,
        take,
        include: CONTENT_INCLUDE,
      }),
      this.prisma.content.count({ where }),
    ]);
    return { items: rows.map((c) => this.toView(c)), meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string): Promise<ContentWithTags> {
    const content = await this.prisma.content.findFirst({
      where: { id, companyId, deletedAt: null },
      include: CONTENT_INCLUDE,
    });
    if (!content || content.status === ContentStatus.DELETED) {
      throw new NotFoundException('Content not found.');
    }
    return content;
  }

  async getDetail(companyId: string, id: string) {
    return this.toView(await this.getScopedOrThrow(companyId, id));
  }

  /** A previewable URL for the content (signed URL for files; the URL for URL content). */
  async preview(companyId: string, id: string) {
    const content = await this.getScopedOrThrow(companyId, id);
    if (content.type === ContentType.URL) return { type: content.type, url: content.url };
    if (content.type === ContentType.TEXT) {
      return { type: content.type, textBody: content.textBody, textStyle: content.textStyle };
    }
    if (!content.storageKey) throw new NotFoundException('No file for this content.');
    const url = await this.storage.getSignedUrl(
      content.storageKey,
      content.mimeType ?? 'application/octet-stream',
    );
    return { type: content.type, url, mimeType: content.mimeType };
  }

  /** Storage + content counts for the company (for the library's usage card). */
  async usageSummary(companyId: string) {
    const evaluation = await this.usageLimits.evaluate(companyId);
    const storage = evaluation.resources.find((r) => r.key === 'storageGb');
    const [byStatus, byType] = await Promise.all([
      this.prisma.content.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.content.groupBy({
        by: ['type'],
        where: { companyId, deletedAt: null, status: { not: ContentStatus.DELETED } },
        _count: { _all: true },
        orderBy: { type: 'asc' },
      }),
    ]);
    return {
      storage: {
        usedBytes: evaluation.usage.storageBytes,
        usedGb: storage?.used ?? 0,
        limitGb: storage?.limit ?? null,
        unlimited: storage?.unlimited ?? true,
        percentUsed: storage?.percentUsed ?? null,
        status: evaluation.status,
        inGrace: evaluation.inGrace,
        gracePeriodEndsAt: evaluation.gracePeriodEndsAt,
      },
      counts: {
        byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
        byType: Object.fromEntries(byType.map((g) => [g.type, g._count._all])),
      },
    };
  }

  // --- Update / replace --------------------------------------------------

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateContentDto) {
    const existing = await this.getScopedOrThrow(companyId, id);

    const data: Prisma.ContentUpdateInput = { updatedById: actor.userId };
    const changed: string[] = [];
    if (dto.title !== undefined) {
      data.title = dto.title;
      changed.push('title');
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
      changed.push('description');
    }
    if (dto.orientation !== undefined) {
      data.orientation = dto.orientation;
      changed.push('orientation');
    }
    if (dto.durationSeconds !== undefined) {
      data.durationSeconds = dto.durationSeconds;
      changed.push('durationSeconds');
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      changed.push('expiresAt');
    }
    if (dto.url !== undefined && existing.type === ContentType.URL) {
      data.url = dto.url;
      changed.push('url');
    }
    if (dto.textBody !== undefined && existing.type === ContentType.TEXT) {
      data.textBody = dto.textBody;
      changed.push('textBody');
    }
    if (dto.textStyle !== undefined && existing.type === ContentType.TEXT) {
      data.textStyle = dto.textStyle as Prisma.InputJsonValue;
      changed.push('textStyle');
    }

    if (dto.tagIds) {
      const valid = await this.validContentTags(companyId, dto.tagIds);
      await this.prisma.$transaction(async (tx) => {
        await tx.contentTag.deleteMany({ where: { contentId: id } });
        if (valid.length) {
          await tx.contentTag.createMany({
            data: valid.map((tagId) => ({ contentId: id, tagId })),
            skipDuplicates: true,
          });
        }
      });
      changed.push('tags');
    }

    const content = await this.prisma.content.update({
      where: { id },
      data,
      include: CONTENT_INCLUDE,
    });
    await this.log(
      actor,
      companyId,
      changed.includes('expiresAt') ? 'content.expiry_changed' : 'content.updated',
      id,
      {
        changes: changed,
      },
    );
    return this.toView(content);
  }

  async replaceFile(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    file: MulterFile | undefined,
  ) {
    if (!file) throw new BadRequestException('A file is required.');
    const existing = await this.getScopedOrThrow(companyId, id);
    const detected = this.detectFileType(file.buffer);
    if (!detected || detected.type !== existing.type) {
      throw new BadRequestException(`Replacement file must be the same type (${existing.type}).`);
    }
    this.assertExtension(detected.type, file.originalname);
    await this.usageLimits.assertFileSize(companyId, file.size);
    const delta = file.size - Number(existing.fileSize ?? 0);
    if (delta > 0)
      await this.usageLimits.assertCanAdd(companyId, 'storageGb', delta / 1_000_000_000);

    const newKey = this.storage.buildKey(companyId, id, file.originalname);
    await this.storage.upload(newKey, file.buffer, detected.mime);

    // Commit the DB pointer BEFORE removing the old file, so a failure never
    // leaves a row pointing at a deleted object.
    let content: ContentWithTags;
    try {
      content = await this.prisma.content.update({
        where: { id },
        data: {
          storageKey: newKey,
          fileSize: BigInt(file.size),
          mimeType: detected.mime,
          originalFileName: file.originalname,
          checksum: this.crypto.sha256Buffer(file.buffer),
          updatedById: actor.userId,
        },
        include: CONTENT_INCLUDE,
      });
    } catch (error) {
      await this.storage.remove(newKey).catch(() => undefined);
      throw error;
    }
    if (existing.storageKey && existing.storageKey !== newKey) {
      await this.storage.remove(existing.storageKey).catch(() => undefined);
    }

    await this.log(actor, companyId, 'content.file_replaced', id, { fileSize: file.size });
    return this.toView(content);
  }

  // --- Lifecycle ---------------------------------------------------------

  async setLifecycle(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    action: 'archive' | 'unarchive' | 'trash' | 'restore',
  ) {
    await this.getScopedOrThrow(companyId, id);
    const content = await this.prisma.content.update({
      where: { id },
      data: { ...this.lifecycleData(action), updatedById: actor.userId },
      include: CONTENT_INCLUDE,
    });
    await this.log(
      actor,
      companyId,
      `content.${action === 'trash' ? 'trashed' : action === 'restore' ? 'restored' : action === 'archive' ? 'archived' : 'unarchived'}`,
      id,
    );
    return this.toView(content);
  }

  async bulkLifecycle(
    companyId: string,
    actor: AuthenticatedUser,
    contentIds: string[],
    action: 'archive' | 'unarchive' | 'trash' | 'restore',
  ) {
    const ids = await this.validContentIds(companyId, contentIds);
    await this.prisma.content.updateMany({
      where: { id: { in: ids }, companyId },
      data: { ...this.lifecycleData(action), updatedById: actor.userId },
    });
    await this.log(actor, companyId, 'content.bulk', action, { action, count: ids.length });
    return { affected: ids.length };
  }

  async bulkTag(companyId: string, actor: AuthenticatedUser, dto: BulkContentTagDto) {
    await this.validContentTags(companyId, [dto.tagId]);
    const ids = await this.validContentIds(companyId, dto.contentIds);
    if (dto.action === 'add') {
      await this.prisma.contentTag.createMany({
        data: ids.map((contentId) => ({ contentId, tagId: dto.tagId })),
        skipDuplicates: true,
      });
    } else {
      await this.prisma.contentTag.deleteMany({
        where: { contentId: { in: ids }, tagId: dto.tagId },
      });
    }
    await this.log(actor, companyId, 'content.tags_bulk', dto.tagId, {
      action: dto.action,
      count: ids.length,
    });
    return { affected: ids.length };
  }

  /** Validate that a content id is a valid fallback selection (ACTIVE, same company). */
  async assertSelectableFallback(companyId: string, contentId: string): Promise<void> {
    const content = await this.prisma.content.findFirst({
      where: { id: contentId, companyId, status: ContentStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    });
    if (!content) {
      throw new BadRequestException(
        'Fallback content must be an active content item in your company.',
      );
    }
  }

  // --- Helpers -----------------------------------------------------------

  private lifecycleData(
    action: 'archive' | 'unarchive' | 'trash' | 'restore',
  ): Prisma.ContentUpdateInput {
    const now = new Date();
    // Each transition fully defines both lifecycle timestamps (no stale values).
    switch (action) {
      case 'archive':
        return { status: ContentStatus.ARCHIVED, archivedAt: now, trashedAt: null };
      case 'unarchive':
        return { status: ContentStatus.ACTIVE, archivedAt: null, trashedAt: null };
      case 'trash':
        return { status: ContentStatus.TRASH, trashedAt: now, archivedAt: null };
      case 'restore':
        return { status: ContentStatus.ACTIVE, trashedAt: null, archivedAt: null };
    }
  }

  private orderBy(sort?: string): Prisma.ContentOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'title':
        return { title: 'asc' };
      case 'size':
        return { fileSize: 'desc' };
      case 'expiry':
        return { expiresAt: { sort: 'asc', nulls: 'last' } };
      default:
        return { createdAt: 'desc' };
    }
  }

  /** Detect content type from the file's magic bytes (server-authoritative). */
  private detectFileType(buffer: Buffer): { type: ContentType; mime: string } | null {
    const b = buffer;
    const ascii = (start: number, str: string) =>
      b.length >= start + str.length && b.toString('latin1', start, start + str.length) === str;

    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { type: ContentType.IMAGE, mime: 'image/png' };
    }
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return { type: ContentType.IMAGE, mime: 'image/jpeg' };
    }
    if (ascii(0, 'GIF8')) return { type: ContentType.IMAGE, mime: 'image/gif' };
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP'))
      return { type: ContentType.IMAGE, mime: 'image/webp' };
    if (ascii(0, '%PDF')) return { type: ContentType.PDF, mime: 'application/pdf' };
    if (ascii(0, 'OggS')) return { type: ContentType.VIDEO, mime: 'video/ogg' };
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
      return { type: ContentType.VIDEO, mime: 'video/webm' };
    }
    if (ascii(4, 'ftyp')) {
      const brand = b.toString('latin1', 8, 12);
      return brand.startsWith('qt')
        ? { type: ContentType.VIDEO, mime: 'video/quicktime' }
        : { type: ContentType.VIDEO, mime: 'video/mp4' };
    }
    return null;
  }

  private assertExtension(type: ContentType, filename: string): void {
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    const allowed = ALLOWED[type]?.exts ?? [];
    if (ext && !allowed.includes(ext)) {
      throw new BadRequestException(`File extension ".${ext}" is not allowed for ${type}.`);
    }
  }

  private parseTags(value?: string): string[] {
    return value
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  }

  private async validContentTags(companyId: string, tagIds: string[]): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.tag.findMany({
      where: { id: { in: unique }, companyId, type: { in: [TagType.CONTENT, TagType.BOTH] } },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException('One or more tags are invalid or not applicable to content.');
    }
    return rows.map((r) => r.id);
  }

  private async validContentIds(companyId: string, contentIds: string[]): Promise<string[]> {
    const unique = [...new Set(contentIds)];
    if (unique.length === 0) throw new BadRequestException('No content provided.');
    const rows = await this.prisma.content.findMany({
      where: {
        id: { in: unique },
        companyId,
        deletedAt: null,
        status: { not: ContentStatus.DELETED },
      },
      select: { id: true },
    });
    if (rows.length !== unique.length)
      throw new BadRequestException('One or more content items are invalid.');
    return rows.map((r) => r.id);
  }

  private toView(content: ContentWithTags) {
    const { storageKey: _k, checksum: _c, meta: _m, tags, ...rest } = content;
    return {
      ...rest,
      tags: tags.map((ct) => ct.tag),
      isExpired: !!content.expiresAt && content.expiresAt.getTime() < Date.now(),
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
      targetType: 'content',
      targetId,
      metadata,
    });
  }
}
