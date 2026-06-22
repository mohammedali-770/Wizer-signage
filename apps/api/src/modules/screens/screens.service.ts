import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma, ScreenStatus, TagType } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { PasswordService } from '../../common/crypto/password.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type {
  BulkScreenGroupDto,
  BulkScreenTagDto,
  CreateScreenDto,
  ListScreensQueryDto,
  UpdateScreenDto,
} from './dto/screen.dto';

const SCREEN_INCLUDE = {
  location: { select: { id: true, name: true } },
  tags: { include: { tag: { select: { id: true, name: true, color: true, type: true } } } },
  groups: { include: { group: { select: { id: true, name: true } } } },
} satisfies Prisma.ScreenInclude;

type ScreenWithRelations = Prisma.ScreenGetPayload<{ include: typeof SCREEN_INCLUDE }>;

@Injectable()
export class ScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly usageLimits: UsageLimitsService,
    private readonly password: PasswordService,
  ) {}

  /** Fallback content must be an ACTIVE content item in the same company. */
  private async assertFallback(companyId: string, contentId: string): Promise<void> {
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

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateScreenDto) {
    await this.usageLimits.assertCanAdd(companyId, 'screens');
    if (dto.locationId) await this.assertLocation(companyId, dto.locationId);
    const createFallback = dto.fallbackContentId?.trim() || null;
    if (createFallback) await this.assertFallback(companyId, createFallback);
    const tagIds = await this.validTagIds(companyId, dto.tagIds ?? []);
    const groupIds = await this.validGroupIds(companyId, dto.groupIds ?? []);

    const screen = await this.prisma.screen.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        locationId: dto.locationId ?? null,
        use: dto.use,
        orientation: dto.orientation,
        status: ScreenStatus.UNPAIRED,
        audioEnabled: dto.audioEnabled ?? true,
        volume: dto.volume ?? 50,
        muted: dto.muted ?? false,
        muteSchedule: (dto.muteSchedule ?? undefined) as Prisma.InputJsonValue | undefined,
        workingHours: (dto.workingHours ?? undefined) as Prisma.InputJsonValue | undefined,
        kioskEnabled: dto.kioskEnabled ?? true,
        kioskPinHash: dto.kioskPin ? await this.password.hash(dto.kioskPin) : null,
        autoStartEnabled: dto.autoStartEnabled ?? false,
        powerControlMode: dto.powerControlMode,
        heartbeatIntervalSeconds: dto.heartbeatIntervalSeconds ?? 60,
        notes: dto.notes,
        fallbackContentId: createFallback,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        groups: groupIds.length ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
      },
      include: SCREEN_INCLUDE,
    });

    await this.log(actor, companyId, 'screen.created', screen.id, { name: screen.name });
    return this.toView(screen);
  }

  async list(companyId: string, query: ListScreensQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ScreenWhereInput = { companyId, deletedAt: null };
    if (query.locationId) where.locationId = query.locationId;
    if (query.status) where.status = query.status;
    if (query.orientation) where.orientation = query.orientation;
    if (query.use) where.use = query.use;
    if (query.tagId) where.tags = { some: { tagId: query.tagId } };
    if (query.groupId) where.groups = { some: { groupId: query.groupId } };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.ScreenOrderByWithRelationInput = {
      [query.sort ?? 'createdAt']: query.order ?? 'desc',
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.screen.findMany({ where, orderBy, skip, take, include: SCREEN_INCLUDE }),
      this.prisma.screen.count({ where }),
    ]);
    return { items: rows.map((s) => this.toView(s)), meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string): Promise<ScreenWithRelations> {
    const screen = await this.prisma.screen.findFirst({
      where: { id, companyId, deletedAt: null },
      include: SCREEN_INCLUDE,
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    return screen;
  }

  async getDetail(companyId: string, id: string) {
    return this.toView(await this.getScopedOrThrow(companyId, id));
  }

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateScreenDto) {
    await this.getScopedOrThrow(companyId, id);
    if (dto.locationId) await this.assertLocation(companyId, dto.locationId);

    const data: Prisma.ScreenUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.use !== undefined) data.use = dto.use;
    if (dto.orientation !== undefined) data.orientation = dto.orientation;
    if (dto.audioEnabled !== undefined) data.audioEnabled = dto.audioEnabled;
    if (dto.volume !== undefined) data.volume = dto.volume;
    if (dto.muted !== undefined) data.muted = dto.muted;
    if (dto.muteSchedule !== undefined)
      data.muteSchedule = dto.muteSchedule as Prisma.InputJsonValue;
    if (dto.workingHours !== undefined)
      data.workingHours = dto.workingHours as Prisma.InputJsonValue;
    if (dto.kioskEnabled !== undefined) data.kioskEnabled = dto.kioskEnabled;
    if (dto.autoStartEnabled !== undefined) data.autoStartEnabled = dto.autoStartEnabled;
    if (dto.powerControlMode !== undefined) data.powerControlMode = dto.powerControlMode;
    if (dto.heartbeatIntervalSeconds !== undefined)
      data.heartbeatIntervalSeconds = dto.heartbeatIntervalSeconds;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.fallbackContentId !== undefined) {
      const fallback = dto.fallbackContentId?.trim() || null;
      if (fallback) await this.assertFallback(companyId, fallback);
      data.fallbackContentId = fallback;
    }
    if (dto.locationId !== undefined) {
      data.location = dto.locationId ? { connect: { id: dto.locationId } } : { disconnect: true };
    }

    const screen = await this.prisma.screen.update({
      where: { id },
      data,
      include: SCREEN_INCLUDE,
    });
    await this.log(actor, companyId, 'screen.updated', id, { changes: Object.keys(data) });
    return this.toView(screen);
  }

  async move(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    locationId: string | null | undefined,
  ) {
    await this.getScopedOrThrow(companyId, id);
    // Distinguish "omitted" (error) from explicit null (unassign); '' also unassigns.
    if (locationId === undefined) {
      throw new BadRequestException('locationId is required (use null to unassign).');
    }
    const target = locationId || null;
    if (target) await this.assertLocation(companyId, target);
    const screen = await this.prisma.screen.update({
      where: { id },
      data: { locationId: target },
      include: SCREEN_INCLUDE,
    });
    await this.log(actor, companyId, 'screen.moved', id, { locationId: target });
    return this.toView(screen);
  }

  async setStatus(companyId: string, actor: AuthenticatedUser, id: string, status: ScreenStatus) {
    const existing = await this.getScopedOrThrow(companyId, id);
    // Reactivating an archived screen re-consumes quota — enforce the plan limit.
    if (existing.status === ScreenStatus.ARCHIVED && status !== ScreenStatus.ARCHIVED) {
      await this.usageLimits.assertCanAdd(companyId, 'screens');
    }
    const screen = await this.prisma.screen.update({
      where: { id },
      data: { status },
      include: SCREEN_INCLUDE,
    });
    const action =
      status === ScreenStatus.ARCHIVED
        ? 'screen.archived'
        : status === ScreenStatus.DISABLED
          ? 'screen.disabled'
          : 'screen.reactivated';
    await this.log(actor, companyId, action, id, { status });
    return this.toView(screen);
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.screen.update({
      where: { id },
      data: { deletedAt: new Date(), status: ScreenStatus.ARCHIVED },
    });
    await this.log(actor, companyId, 'screen.deleted', id);
  }

  async assignTags(companyId: string, actor: AuthenticatedUser, id: string, tagIds: string[]) {
    await this.getScopedOrThrow(companyId, id);
    const valid = await this.validTagIds(companyId, tagIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.screenTag.deleteMany({ where: { screenId: id } });
      if (valid.length) {
        await tx.screenTag.createMany({
          data: valid.map((tagId) => ({ screenId: id, tagId })),
          skipDuplicates: true,
        });
      }
    });
    await this.log(actor, companyId, 'screen.tags_assigned', id, { tagIds: valid });
    return this.getDetail(companyId, id);
  }

  async assignGroups(companyId: string, actor: AuthenticatedUser, id: string, groupIds: string[]) {
    await this.getScopedOrThrow(companyId, id);
    const valid = await this.validGroupIds(companyId, groupIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.screenGroupMember.deleteMany({ where: { screenId: id } });
      if (valid.length) {
        await tx.screenGroupMember.createMany({
          data: valid.map((groupId) => ({ screenId: id, groupId })),
          skipDuplicates: true,
        });
      }
    });
    await this.log(actor, companyId, 'screen.groups_assigned', id, { groupIds: valid });
    return this.getDetail(companyId, id);
  }

  async setKioskPin(companyId: string, actor: AuthenticatedUser, id: string, pin: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.screen.update({
      where: { id },
      data: { kioskPinHash: await this.password.hash(pin) },
    });
    await this.log(actor, companyId, 'screen.kiosk_pin_changed', id);
    return { updated: true };
  }

  async resetKioskPin(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.screen.update({ where: { id }, data: { kioskPinHash: null } });
    await this.log(actor, companyId, 'screen.kiosk_pin_reset', id);
    return { reset: true };
  }

  async bulkTag(companyId: string, actor: AuthenticatedUser, dto: BulkScreenTagDto) {
    await this.validTagIds(companyId, [dto.tagId]);
    const screenIds = await this.validScreenIds(companyId, dto.screenIds);
    if (dto.action === 'add') {
      await this.prisma.screenTag.createMany({
        data: screenIds.map((screenId) => ({ screenId, tagId: dto.tagId })),
        skipDuplicates: true,
      });
    } else {
      await this.prisma.screenTag.deleteMany({
        where: { screenId: { in: screenIds }, tagId: dto.tagId },
      });
    }
    await this.log(actor, companyId, 'screen.tags_bulk', dto.tagId, {
      action: dto.action,
      tagId: dto.tagId,
      count: screenIds.length,
    });
    return { affected: screenIds.length };
  }

  async bulkGroup(companyId: string, actor: AuthenticatedUser, dto: BulkScreenGroupDto) {
    await this.validGroupIds(companyId, [dto.groupId]);
    const screenIds = await this.validScreenIds(companyId, dto.screenIds);
    if (dto.action === 'add') {
      await this.prisma.screenGroupMember.createMany({
        data: screenIds.map((screenId) => ({ screenId, groupId: dto.groupId })),
        skipDuplicates: true,
      });
    } else {
      await this.prisma.screenGroupMember.deleteMany({
        where: { screenId: { in: screenIds }, groupId: dto.groupId },
      });
    }
    await this.log(actor, companyId, 'screen.groups_bulk', dto.groupId, {
      action: dto.action,
      groupId: dto.groupId,
      count: screenIds.length,
    });
    return { affected: screenIds.length };
  }

  // --- Validation helpers (tenant-scoped) --------------------------------

  private async assertLocation(companyId: string, locationId: string): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Location is invalid or not in this company.');
  }

  private async validTagIds(companyId: string, tagIds: string[]): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];
    // Only SCREEN (or BOTH) tags may be attached to screens — not CONTENT-only tags.
    const rows = await this.prisma.tag.findMany({
      where: { id: { in: unique }, companyId, type: { in: [TagType.SCREEN, TagType.BOTH] } },
      select: { id: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException('One or more tags are invalid or not applicable to screens.');
    }
    return rows.map((r) => r.id);
  }

  private async validGroupIds(companyId: string, groupIds: string[]): Promise<string[]> {
    const unique = [...new Set(groupIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.screenGroup.findMany({
      where: { id: { in: unique }, companyId },
      select: { id: true },
    });
    if (rows.length !== unique.length)
      throw new BadRequestException('One or more screen groups are invalid.');
    return rows.map((r) => r.id);
  }

  private async validScreenIds(companyId: string, screenIds: string[]): Promise<string[]> {
    const unique = [...new Set(screenIds)];
    if (unique.length === 0) throw new BadRequestException('No screens provided.');
    const rows = await this.prisma.screen.findMany({
      where: { id: { in: unique }, companyId, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== unique.length)
      throw new BadRequestException('One or more screens are invalid.');
    return rows.map((r) => r.id);
  }

  private toView(screen: ScreenWithRelations) {
    const { kioskPinHash, tags, groups, ...rest } = screen;
    return {
      ...rest,
      hasKioskPin: !!kioskPinHash,
      tags: tags.map((st) => st.tag),
      groups: groups.map((gm) => gm.group),
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
      targetType: 'screen',
      targetId,
      metadata,
    });
  }
}
