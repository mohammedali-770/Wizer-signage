import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ContentStatus,
  DeviceCommandType,
  EmergencyBroadcastStatus,
  EmergencyBroadcastType,
  Orientation,
  PlaylistStatus,
  Prisma,
  ScheduleTargetType,
} from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { orientationProfile, orientationWarning } from '../../common/scheduling/orientation.util';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DeviceCommandService } from '../monitoring/device-command.service';
import { AlertService } from '../notifications/alert.service';
import { AlertEvent } from '../notifications/notifications.constants';
import { SchedulesService } from '../schedules/schedules.service';
import { expandTargets, type ScreenIndex } from '../schedules/schedule-targeting';
import type {
  CreateEmergencyBroadcastDto,
  EmergencyTargetDto,
  ListEmergencyBroadcastsQueryDto,
  QuickTextBroadcastDto,
  UpdateEmergencyBroadcastDto,
} from './dto/emergency-broadcast.dto';

const ACTIVITY_CATEGORY = 'EMERGENCY';

type BroadcastWithTargets = Prisma.EmergencyBroadcastGetPayload<{ include: { targets: true } }>;

/** Fields that define what a broadcast plays (used by validation + dispatch). */
interface BroadcastShape {
  broadcastType: EmergencyBroadcastType;
  contentId: string | null;
  playlistId: string | null;
  message: string | null;
  url: string | null;
  startAt: Date | null;
  endAt: Date | null;
}

interface ValidationResult {
  errors: string[];
  warnings: string[];
  affectedScreenIds: string[];
}

/**
 * Emergency Broadcast management (Phase 9). Company-scoped CRUD + lifecycle.
 * Activation/pause/end fan a REFRESH_MANIFEST command (Phase 8 path) out to the
 * affected screens so they re-resolve promptly; the resolver does the actual
 * pre-emption. Tenant isolation is enforced everywhere — a broadcast can only
 * reference and target its own company's content/playlists/screens.
 */
@Injectable()
export class EmergencyBroadcastService {
  private readonly logger = new Logger(EmergencyBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly schedules: SchedulesService,
    private readonly commands: DeviceCommandService,
    private readonly alerts: AlertService,
  ) {}

  // --- Read --------------------------------------------------------------

  async list(companyId: string, query: ListEmergencyBroadcastsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.EmergencyBroadcastWhereInput = { companyId };
    if (query.status) where.status = query.status;
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.emergencyBroadcast.findMany({
        where,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take,
        include: { targets: true },
      }),
      this.prisma.emergencyBroadcast.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total) };
  }

  async getDetail(companyId: string, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    const validation = await this.inspect(companyId, broadcast, broadcast.targets);
    return {
      ...this.toView(broadcast),
      ...validation,
      affectedScreens: validation.affectedScreenIds.length,
    };
  }

  /** Non-throwing validation report for the dashboard (errors + warnings + reach). */
  async validate(companyId: string, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    const v = await this.inspect(companyId, broadcast, broadcast.targets);
    return {
      valid: v.errors.length === 0 && v.affectedScreenIds.length > 0,
      canActivate:
        v.errors.length === 0 &&
        v.affectedScreenIds.length > 0 &&
        broadcast.status !== EmergencyBroadcastStatus.ENDED &&
        broadcast.status !== EmergencyBroadcastStatus.ARCHIVED,
      errors: v.errors,
      warnings: v.warnings,
      affectedScreens: v.affectedScreenIds.length,
    };
  }

  // --- Create / update ---------------------------------------------------

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateEmergencyBroadcastDto) {
    const shape = this.shapeFromDto(dto);
    const targets = dto.targets ?? [];
    await this.assertRefsValid(companyId, shape);
    await this.assertTargetsOwned(companyId, targets);

    const broadcast = await this.prisma.emergencyBroadcast.create({
      data: {
        companyId,
        title: dto.title,
        description: dto.description ?? null,
        broadcastType: dto.broadcastType,
        message: dto.message ?? null,
        url: dto.url ?? null,
        contentId:
          dto.broadcastType === EmergencyBroadcastType.CONTENT ? (dto.contentId ?? null) : null,
        playlistId:
          dto.broadcastType === EmergencyBroadcastType.PLAYLIST ? (dto.playlistId ?? null) : null,
        priority: dto.priority ?? 100,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        status: EmergencyBroadcastStatus.DRAFT,
        createdById: actor.userId,
        updatedById: actor.userId,
        targets: targets.length
          ? { create: targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })) }
          : undefined,
      },
      include: { targets: true },
    });

    await this.log(actor, companyId, 'emergency.created', broadcast.id, {
      title: broadcast.title,
      type: broadcast.broadcastType,
    });
    return this.toView(broadcast);
  }

  async update(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateEmergencyBroadcastDto,
  ) {
    const existing = await this.loadOwned(companyId, id);
    if (existing.status === EmergencyBroadcastStatus.ARCHIVED) {
      throw new BadRequestException('Archived broadcasts cannot be edited.');
    }
    const broadcastType = dto.broadcastType ?? existing.broadcastType;
    const shape: BroadcastShape = {
      broadcastType,
      contentId: dto.contentId !== undefined ? dto.contentId : existing.contentId,
      playlistId: dto.playlistId !== undefined ? dto.playlistId : existing.playlistId,
      message: dto.message !== undefined ? dto.message : existing.message,
      url: dto.url !== undefined ? dto.url : existing.url,
      startAt:
        dto.startAt !== undefined ? (dto.startAt ? new Date(dto.startAt) : null) : existing.startAt,
      endAt: dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : existing.endAt,
    };
    await this.assertRefsValid(companyId, shape);

    const updated = await this.prisma.emergencyBroadcast.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        broadcastType,
        message: dto.message ?? undefined,
        url: dto.url ?? undefined,
        // Keep the non-active content reference null so only the active type carries a ref.
        contentId: broadcastType === EmergencyBroadcastType.CONTENT ? shape.contentId : null,
        playlistId: broadcastType === EmergencyBroadcastType.PLAYLIST ? shape.playlistId : null,
        priority: dto.priority ?? undefined,
        startAt: shape.startAt,
        endAt: shape.endAt,
        updatedById: actor.userId,
      },
      include: { targets: true },
    });

    await this.log(actor, companyId, 'emergency.updated', id, {});
    // A live edit should reach screens promptly.
    if (updated.status === EmergencyBroadcastStatus.ACTIVE) {
      await this.dispatchRefresh(companyId, actor, updated, 'updated');
    }
    return this.toView(updated);
  }

  // --- Lifecycle ---------------------------------------------------------

  async activate(companyId: string, actor: AuthenticatedUser, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    if (
      broadcast.status === EmergencyBroadcastStatus.ENDED ||
      broadcast.status === EmergencyBroadcastStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        'An ended or archived broadcast cannot be re-activated; create a new one.',
      );
    }
    const v = await this.inspect(companyId, broadcast, broadcast.targets);
    if (v.errors.length) throw new BadRequestException(v.errors[0]);
    if (v.affectedScreenIds.length === 0)
      throw new BadRequestException('Add at least one target before activating.');

    const updated = await this.prisma.emergencyBroadcast.update({
      where: { id },
      data: {
        status: EmergencyBroadcastStatus.ACTIVE,
        startAt: broadcast.startAt ?? new Date(),
        stoppedAt: null,
        updatedById: actor.userId,
      },
      include: { targets: true },
    });
    await this.log(actor, companyId, 'emergency.activated', id, {
      affectedScreens: v.affectedScreenIds.length,
    });
    await this.dispatchRefresh(companyId, actor, updated, 'activated', v.affectedScreenIds);
    await this.alerts
      .raise({
        companyId,
        type: AlertEvent.EmergencyActivated,
        title: `Emergency broadcast activated: ${updated.title}`,
        message: `Pre-empting schedules on ${v.affectedScreenIds.length} screen target(s).`,
        metadata: { emergencyBroadcastId: id, affectedScreens: v.affectedScreenIds.length },
        dedupeKey: `${companyId}:emergency:${id}:active`,
      })
      .catch(() => undefined);
    return {
      ...this.toView(updated),
      affectedScreens: v.affectedScreenIds.length,
      warnings: v.warnings,
    };
  }

  async pause(companyId: string, actor: AuthenticatedUser, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    if (broadcast.status !== EmergencyBroadcastStatus.ACTIVE) {
      throw new BadRequestException('Only an active broadcast can be paused.');
    }
    const updated = await this.prisma.emergencyBroadcast.update({
      where: { id },
      data: { status: EmergencyBroadcastStatus.PAUSED, updatedById: actor.userId },
      include: { targets: true },
    });
    await this.log(actor, companyId, 'emergency.paused', id, {});
    // Screens should fall back to their schedule immediately.
    await this.dispatchRefresh(companyId, actor, updated, 'paused');
    return this.toView(updated);
  }

  async end(companyId: string, actor: AuthenticatedUser, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    if (
      broadcast.status === EmergencyBroadcastStatus.ENDED ||
      broadcast.status === EmergencyBroadcastStatus.ARCHIVED
    ) {
      return this.toView(broadcast); // idempotent
    }
    const updated = await this.prisma.emergencyBroadcast.update({
      where: { id },
      data: {
        status: EmergencyBroadcastStatus.ENDED,
        stoppedAt: new Date(),
        updatedById: actor.userId,
      },
      include: { targets: true },
    });
    await this.log(actor, companyId, 'emergency.ended', id, {});
    await this.dispatchRefresh(companyId, actor, updated, 'ended');
    // Resolve the "activated" alert and emit a one-time "ended" notification.
    await this.alerts.resolveByKey(`${companyId}:emergency:${id}:active`).catch(() => undefined);
    await this.alerts
      .raise({
        companyId,
        type: AlertEvent.EmergencyEnded,
        title: `Emergency broadcast ended: ${updated.title}`,
        message: 'Targeted screens are returning to their normal schedule.',
        metadata: { emergencyBroadcastId: id },
        dedupeKey: `${companyId}:emergency:${id}:ended:${Date.now()}`,
        informational: true,
      })
      .catch(() => undefined);
    return this.toView(updated);
  }

  /**
   * Auto-end ACTIVE/SCHEDULED broadcasts whose endAt has passed (Phase 10
   * maintenance). Idempotent; reuses end() so it dispatches refresh commands +
   * resolves/raises alerts identically. Returns the ended broadcast ids.
   */
  async endExpired(now: Date = new Date()): Promise<string[]> {
    const expired = await this.prisma.emergencyBroadcast.findMany({
      where: {
        status: { in: [EmergencyBroadcastStatus.ACTIVE, EmergencyBroadcastStatus.SCHEDULED] },
        endAt: { not: null, lt: now },
      },
      select: { id: true, companyId: true, createdById: true },
    });
    const ended: string[] = [];
    for (const b of expired) {
      // System actor (no dashboard user) — activity log records actorId null.
      const systemActor = {
        userId: b.createdById ?? null,
        companyId: b.companyId,
      } as unknown as AuthenticatedUser;
      try {
        await this.end(b.companyId, systemActor, b.id);
        await this.activityLog.log({
          action: 'emergency.auto_ended',
          category: ACTIVITY_CATEGORY,
          companyId: b.companyId,
          targetType: 'emergency_broadcast',
          targetId: b.id,
          metadata: { reason: 'endAt_passed' },
        });
        ended.push(b.id);
      } catch {
        // One bad broadcast must not abort the batch.
      }
    }
    return ended;
  }

  async archive(companyId: string, actor: AuthenticatedUser, id: string) {
    const broadcast = await this.loadOwned(companyId, id);
    if (
      broadcast.status === EmergencyBroadcastStatus.ACTIVE ||
      broadcast.status === EmergencyBroadcastStatus.PAUSED
    ) {
      throw new BadRequestException('End the broadcast before archiving it.');
    }
    const updated = await this.prisma.emergencyBroadcast.update({
      where: { id },
      data: { status: EmergencyBroadcastStatus.ARCHIVED, updatedById: actor.userId },
      include: { targets: true },
    });
    await this.log(actor, companyId, 'emergency.archived', id, {});
    return this.toView(updated);
  }

  // --- Targets -----------------------------------------------------------

  async addTarget(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: EmergencyTargetDto,
  ) {
    const broadcast = await this.loadOwned(companyId, id);
    if (
      broadcast.status === EmergencyBroadcastStatus.ARCHIVED ||
      broadcast.status === EmergencyBroadcastStatus.ENDED
    ) {
      throw new BadRequestException('Cannot change targets on an ended or archived broadcast.');
    }
    await this.assertTargetsOwned(companyId, [dto]);
    await this.prisma.emergencyBroadcastTarget.upsert({
      where: {
        broadcastId_targetType_targetId: {
          broadcastId: id,
          targetType: dto.targetType,
          targetId: dto.targetId,
        },
      },
      create: { broadcastId: id, targetType: dto.targetType, targetId: dto.targetId },
      update: {},
    });
    await this.log(actor, companyId, 'emergency.targets_changed', id, {
      added: `${dto.targetType}:${dto.targetId}`,
    });
    const reloaded = await this.loadOwned(companyId, id);
    if (reloaded.status === EmergencyBroadcastStatus.ACTIVE) {
      await this.dispatchRefresh(companyId, actor, reloaded, 'targets_changed');
    }
    return this.getDetail(companyId, id);
  }

  async removeTarget(companyId: string, actor: AuthenticatedUser, id: string, targetId: string) {
    const broadcast = await this.loadOwned(companyId, id);
    const target = broadcast.targets.find((t) => t.id === targetId);
    if (!target) throw new NotFoundException('Target not found.');
    await this.prisma.emergencyBroadcastTarget.delete({ where: { id: targetId } });
    await this.log(actor, companyId, 'emergency.targets_changed', id, {
      removed: `${target.targetType}:${target.targetId}`,
    });
    if (broadcast.status === EmergencyBroadcastStatus.ACTIVE) {
      // Refresh BOTH the still-targeted screens and the one we just dropped.
      await this.dispatchRefresh(companyId, actor, broadcast, 'targets_changed');
    }
    return this.getDetail(companyId, id);
  }

  // --- Quick text --------------------------------------------------------

  /** Create + activate a text broadcast in one step. */
  async quickText(companyId: string, actor: AuthenticatedUser, dto: QuickTextBroadcastDto) {
    await this.assertTargetsOwned(companyId, dto.targets);
    const index = await this.schedules.buildScreenIndex(companyId);
    const affected = [...expandTargets(dto.targets, index)];
    if (affected.length === 0)
      throw new BadRequestException('Quick text broadcast needs at least one target with screens.');

    const broadcast = await this.prisma.emergencyBroadcast.create({
      data: {
        companyId,
        title: dto.title,
        broadcastType: EmergencyBroadcastType.TEXT,
        message: dto.message,
        priority: dto.priority ?? 100,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        status: EmergencyBroadcastStatus.ACTIVE,
        startAt: new Date(),
        createdById: actor.userId,
        updatedById: actor.userId,
        targets: {
          create: dto.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })),
        },
      },
      include: { targets: true },
    });
    await this.log(actor, companyId, 'emergency.quick_text', broadcast.id, {
      affectedScreens: affected.length,
    });
    await this.dispatchRefresh(companyId, actor, broadcast, 'quick_text', affected);
    return { ...this.toView(broadcast), affectedScreens: affected.length };
  }

  // --- Command dispatch --------------------------------------------------

  private async dispatchRefresh(
    companyId: string,
    actor: AuthenticatedUser,
    broadcast: BroadcastWithTargets,
    reason: string,
    precomputed?: string[],
  ): Promise<void> {
    // Best-effort: the lifecycle status change is authoritative, and screens
    // also re-resolve on their regular manifest poll, so a refresh-dispatch
    // failure must NEVER abort the transition (or, in endExpired, the batch).
    try {
      const index = precomputed ? null : await this.schedules.buildScreenIndex(companyId);
      const screenIds = precomputed ?? [...expandTargets(broadcast.targets, index as ScreenIndex)];
      if (screenIds.length === 0) return;
      const count = await this.commands.dispatchToScreens(
        companyId,
        screenIds,
        DeviceCommandType.REFRESH_MANIFEST,
        {
          reason: `emergency:${reason}`,
          emergencyBroadcastId: broadcast.id,
        },
      );
      await this.log(actor, companyId, 'emergency.refresh_dispatched', broadcast.id, {
        reason,
        screens: screenIds.length,
        commands: count,
      });
    } catch (e) {
      this.logger.warn(
        `Emergency refresh dispatch failed for ${broadcast.id} (${reason}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // --- Validation --------------------------------------------------------

  private shapeFromDto(dto: CreateEmergencyBroadcastDto): BroadcastShape {
    return {
      broadcastType: dto.broadcastType,
      contentId: dto.contentId ?? null,
      playlistId: dto.playlistId ?? null,
      message: dto.message ?? null,
      url: dto.url ?? null,
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
    };
  }

  /** Throw on a hard reference problem (used by create/update). */
  private async assertRefsValid(companyId: string, shape: BroadcastShape): Promise<void> {
    const errors = await this.refErrors(companyId, shape);
    if (errors.length) throw new BadRequestException(errors[0]);
  }

  private async refErrors(companyId: string, shape: BroadcastShape): Promise<string[]> {
    const errors: string[] = [];
    switch (shape.broadcastType) {
      case EmergencyBroadcastType.CONTENT: {
        if (!shape.contentId) {
          errors.push('Content is required for a CONTENT broadcast.');
          break;
        }
        const content = await this.prisma.content.findFirst({
          where: { id: shape.contentId, companyId, deletedAt: null },
          select: { status: true, expiresAt: true },
        });
        if (!content) errors.push('Content not found in this company.');
        else if (content.status !== ContentStatus.ACTIVE)
          errors.push('Emergency content must be ACTIVE.');
        else if (content.expiresAt && content.expiresAt.getTime() <= Date.now())
          errors.push('Emergency content has expired.');
        break;
      }
      case EmergencyBroadcastType.PLAYLIST: {
        if (!shape.playlistId) {
          errors.push('Playlist is required for a PLAYLIST broadcast.');
          break;
        }
        const playlist = await this.prisma.playlist.findFirst({
          where: { id: shape.playlistId, companyId, deletedAt: null },
          select: { status: true },
        });
        if (!playlist) errors.push('Playlist not found in this company.');
        else if (playlist.status !== PlaylistStatus.ACTIVE)
          errors.push('Emergency playlist must be ACTIVE.');
        break;
      }
      case EmergencyBroadcastType.TEXT:
        if (!shape.message || !shape.message.trim())
          errors.push('Message text is required for a TEXT broadcast.');
        break;
      case EmergencyBroadcastType.URL:
        if (!shape.url || !shape.url.trim()) errors.push('A URL is required for a URL broadcast.');
        break;
    }
    if (shape.startAt && shape.endAt && shape.endAt.getTime() <= shape.startAt.getTime()) {
      errors.push('endAt must be after startAt.');
    }
    return errors;
  }

  /** Throw if any provided target is not in this company. */
  private async assertTargetsOwned(
    companyId: string,
    targets: EmergencyTargetDto[],
  ): Promise<void> {
    const valid = await this.ownedTargetKeys(companyId, targets);
    for (const t of targets) {
      if (!valid.has(`${t.targetType}:${t.targetId}`)) {
        throw new BadRequestException(
          `Target ${t.targetType.toLowerCase()} is invalid or not in this company.`,
        );
      }
    }
  }

  /** Set of "type:id" keys for the targets that genuinely belong to the company. */
  private async ownedTargetKeys(
    companyId: string,
    targets: EmergencyTargetDto[],
  ): Promise<Set<string>> {
    const screenIds = targets
      .filter((t) => t.targetType === ScheduleTargetType.SCREEN)
      .map((t) => t.targetId);
    const groupIds = targets
      .filter((t) => t.targetType === ScheduleTargetType.SCREEN_GROUP)
      .map((t) => t.targetId);
    const locationIds = targets
      .filter((t) => t.targetType === ScheduleTargetType.LOCATION)
      .map((t) => t.targetId);
    const [screens, groups, locations] = await this.prisma.$transaction([
      this.prisma.screen.findMany({
        where: { id: { in: screenIds }, companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.screenGroup.findMany({
        where: { id: { in: groupIds }, companyId },
        select: { id: true },
      }),
      this.prisma.location.findMany({
        where: { id: { in: locationIds }, companyId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const valid = new Set<string>();
    screens.forEach((s) => valid.add(`${ScheduleTargetType.SCREEN}:${s.id}`));
    groups.forEach((g) => valid.add(`${ScheduleTargetType.SCREEN_GROUP}:${g.id}`));
    locations.forEach((l) => valid.add(`${ScheduleTargetType.LOCATION}:${l.id}`));
    for (const t of targets) {
      // COMPANY = "all of this company's screens"; the targetId is cosmetic
      // (expansion + matching are already scoped to the tenant), so accept any.
      if (t.targetType === ScheduleTargetType.COMPANY) {
        valid.add(`${ScheduleTargetType.COMPANY}:${t.targetId}`);
      }
    }
    return valid;
  }

  /** Full non-throwing inspection: ref errors + target validity + orientation warnings + reach. */
  private async inspect(
    companyId: string,
    broadcast: BroadcastShape & { targets: EmergencyTargetDto[] },
    targets: EmergencyTargetDto[],
  ): Promise<ValidationResult> {
    const errors = await this.refErrors(companyId, broadcast);
    const warnings: string[] = [];

    const validKeys = await this.ownedTargetKeys(companyId, targets);
    const validTargets: EmergencyTargetDto[] = [];
    for (const t of targets) {
      if (validKeys.has(`${t.targetType}:${t.targetId}`)) validTargets.push(t);
      else errors.push(`Target ${t.targetType.toLowerCase()} is invalid or not in this company.`);
    }

    const index = await this.schedules.buildScreenIndex(companyId);
    const affectedScreenIds = [...expandTargets(validTargets, index)];

    const profile = await this.contentOrientationProfile(companyId, broadcast);
    if (profile && profile !== 'UNKNOWN') {
      const orientations = new Set<Orientation>();
      for (const id of affectedScreenIds) {
        const o = index.byId.get(id)?.orientation;
        if (o && o !== Orientation.UNKNOWN) orientations.add(o);
      }
      for (const o of orientations) {
        const w = orientationWarning(profile, o, 'Emergency content');
        if (w) warnings.push(w);
      }
    }
    return { errors, warnings, affectedScreenIds };
  }

  private async contentOrientationProfile(companyId: string, shape: BroadcastShape) {
    if (shape.broadcastType === EmergencyBroadcastType.CONTENT && shape.contentId) {
      const content = await this.prisma.content.findFirst({
        where: { id: shape.contentId, companyId },
        select: { orientation: true },
      });
      return content ? orientationProfile([content.orientation]) : null;
    }
    if (shape.broadcastType === EmergencyBroadcastType.PLAYLIST && shape.playlistId) {
      const items = await this.prisma.playlistItem.findMany({
        where: { playlistId: shape.playlistId },
        select: { content: { select: { orientation: true } } },
      });
      return orientationProfile(items.map((i) => i.content?.orientation ?? Orientation.UNKNOWN));
    }
    return null;
  }

  // --- Helpers -----------------------------------------------------------

  private async loadOwned(companyId: string, id: string): Promise<BroadcastWithTargets> {
    const broadcast = await this.prisma.emergencyBroadcast.findFirst({
      where: { id, companyId },
      include: { targets: true },
    });
    if (!broadcast) throw new NotFoundException('Emergency broadcast not found.');
    return broadcast;
  }

  private async log(
    actor: AuthenticatedUser,
    companyId: string,
    action: string,
    id: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.activityLog.log({
      action,
      category: ACTIVITY_CATEGORY,
      actorId: actor.userId,
      companyId,
      targetType: 'emergency_broadcast',
      targetId: id,
      metadata,
    });
  }

  private toView(b: BroadcastWithTargets) {
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      broadcastType: b.broadcastType,
      message: b.message,
      url: b.url,
      contentId: b.contentId,
      playlistId: b.playlistId,
      priority: b.priority,
      status: b.status,
      startAt: b.startAt ? b.startAt.toISOString() : null,
      endAt: b.endAt ? b.endAt.toISOString() : null,
      stoppedAt: b.stoppedAt ? b.stoppedAt.toISOString() : null,
      targets: b.targets.map((t) => ({ id: t.id, targetType: t.targetType, targetId: t.targetId })),
      createdById: b.createdById,
      updatedById: b.updatedById,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }
}
