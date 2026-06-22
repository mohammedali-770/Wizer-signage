import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Orientation,
  Prisma,
  ScheduleStatus,
  ScheduleTargetType,
  ScheduleType,
} from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import { orientationWarning } from '../../common/scheduling/orientation.util';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { PlaylistsService } from '../playlists/playlists.service';
import type {
  AddScheduleTargetDto,
  CreateScheduleDto,
  ListSchedulesQueryDto,
  ScheduleTargetInputDto,
  UpdateScheduleDto,
} from './dto/schedule.dto';
import {
  type ConflictSchedule,
  expandTargets,
  type IndexedScreen,
  pickWinner,
  type ScreenIndex,
  schedulesConflict,
} from './schedule-targeting';

const SCHEDULE_INCLUDE = {
  targets: true,
  playlist: { select: { id: true, title: true, status: true } },
} satisfies Prisma.ScheduleInclude;

type ScheduleWithTargets = Prisma.ScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly playlists: PlaylistsService,
  ) {}

  // --- Create ------------------------------------------------------------

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateScheduleDto) {
    this.validateTiming({
      startDate: dto.startDate,
      endDate: dto.endDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
      isAllDay: dto.isAllDay,
    });
    if (dto.playlistId) await this.assertPlaylist(companyId, dto.playlistId);
    const targets = await this.normalizeTargets(companyId, dto.targets ?? []);
    const status = dto.status ?? ScheduleStatus.ACTIVE;
    if (status === ScheduleStatus.ACTIVE) {
      await this.assertActivatable(companyId, dto.playlistId ?? null, targets.length);
    }

    const schedule = await this.prisma.schedule.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description,
        playlistId: dto.playlistId ?? null,
        status,
        scheduleType: dto.scheduleType ?? ScheduleType.NORMAL,
        priority: dto.priority ?? 0,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        startTime: dto.isAllDay ? null : (dto.startTime ?? null),
        endTime: dto.isAllDay ? null : (dto.endTime ?? null),
        isAllDay: dto.isAllDay ?? false,
        daysOfWeek: dto.daysOfWeek ?? [],
        recurrence: (dto.recurrence ?? undefined) as Prisma.InputJsonValue | undefined,
        timezone: dto.timezone,
        createdById: actor.userId,
        updatedById: actor.userId,
        targets: targets.length ? { create: targets } : undefined,
      },
      include: SCHEDULE_INCLUDE,
    });
    await this.log(actor, companyId, 'schedule.created', schedule.id, { name: schedule.name });
    return this.toView(schedule);
  }

  // --- Read --------------------------------------------------------------

  async list(companyId: string, query: ListSchedulesQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ScheduleWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.scheduleType) where.scheduleType = query.scheduleType;
    if (query.priority !== undefined) where.priority = query.priority;
    if (query.targetType) where.targets = { some: { targetType: query.targetType } };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      // Schedules whose active window intersects [dateFrom, dateTo].
      const and: Prisma.ScheduleWhereInput[] = [];
      if (query.dateTo) and.push({ startDate: { lte: new Date(query.dateTo) } });
      if (query.dateFrom)
        and.push({ OR: [{ endDate: null }, { endDate: { gte: new Date(query.dateFrom) } }] });
      where.AND = and;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.schedule.findMany({
        where,
        orderBy: this.orderBy(query.sort),
        skip,
        take,
        include: SCHEDULE_INCLUDE,
      }),
      this.prisma.schedule.count({ where }),
    ]);
    return { items: rows.map((s) => this.toView(s)), meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string): Promise<ScheduleWithTargets> {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id, companyId, deletedAt: null },
      include: SCHEDULE_INCLUDE,
    });
    if (!schedule) throw new NotFoundException('Schedule not found.');
    return schedule;
  }

  async getDetail(companyId: string, id: string) {
    return this.toView(await this.getScopedOrThrow(companyId, id));
  }

  /** Validation summary: playlist validity, targets, orientation + conflict warnings. */
  async validate(companyId: string, id: string) {
    const schedule = await this.getScopedOrThrow(companyId, id);
    const playlistValidity = schedule.playlistId
      ? await this.playlists.validate(companyId, schedule.playlistId).catch(() => null)
      : null;

    const index = await this.buildScreenIndex(companyId);
    const orientationWarnings = await this.orientationWarnings(companyId, schedule, index);
    const conflicts = await this.conflictsForSchedule(companyId, schedule, index);

    const timingWarnings: string[] = [];
    if (!schedule.playlistId) timingWarnings.push('No playlist assigned.');
    else if (playlistValidity && !playlistValidity.schedulable) {
      timingWarnings.push('Assigned playlist has no valid items.');
    }
    if (schedule.targets.length === 0) timingWarnings.push('No targets assigned.');

    const schedulable =
      !!schedule.playlistId && !!playlistValidity?.schedulable && schedule.targets.length > 0;

    return {
      id: schedule.id,
      schedulable,
      playlist: playlistValidity
        ? {
            id: schedule.playlistId,
            schedulable: playlistValidity.schedulable,
            validItemCount: playlistValidity.validItemCount,
          }
        : null,
      targetCount: schedule.targets.length,
      orientationWarnings,
      conflicts,
      warnings: [...timingWarnings, ...orientationWarnings],
    };
  }

  // --- Update / lifecycle ------------------------------------------------

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateScheduleDto) {
    const existing = await this.getScopedOrThrow(companyId, id);
    this.validateTiming({
      startDate: dto.startDate ?? existing.startDate?.toISOString(),
      endDate: dto.endDate === undefined ? existing.endDate?.toISOString() : dto.endDate,
      startTime: dto.startTime === undefined ? existing.startTime : dto.startTime,
      endTime: dto.endTime === undefined ? existing.endTime : dto.endTime,
      isAllDay: dto.isAllDay ?? existing.isAllDay,
    });
    if (dto.playlistId) await this.assertPlaylist(companyId, dto.playlistId);

    const data: Prisma.ScheduleUpdateInput = { updatedById: actor.userId };
    const changed: string[] = [];
    const set = <K extends keyof Prisma.ScheduleUpdateInput>(
      key: K,
      value: Prisma.ScheduleUpdateInput[K],
    ) => {
      data[key] = value;
      changed.push(key as string);
    };
    if (dto.name !== undefined) set('name', dto.name);
    if (dto.description !== undefined) set('description', dto.description);
    if (dto.playlistId !== undefined) {
      data.playlist = dto.playlistId ? { connect: { id: dto.playlistId } } : { disconnect: true };
      changed.push('playlistId');
      // Invariant: an ACTIVE schedule must keep a valid playlist. Re-validate on
      // any playlist change so it can't be left ACTIVE with a detached/invalid one.
      const willBeActive = (dto.status ?? existing.status) === ScheduleStatus.ACTIVE;
      if (willBeActive)
        await this.assertActivatable(companyId, dto.playlistId, existing.targets.length);
    }
    if (dto.scheduleType !== undefined) set('scheduleType', dto.scheduleType);
    if (dto.priority !== undefined) set('priority', dto.priority);
    if (dto.startDate !== undefined) set('startDate', new Date(dto.startDate));
    if (dto.endDate !== undefined) set('endDate', dto.endDate ? new Date(dto.endDate) : null);
    if (dto.isAllDay !== undefined) set('isAllDay', dto.isAllDay);
    // Times: when all-day (effective), force null; otherwise apply provided value.
    const effectiveAllDay = dto.isAllDay ?? existing.isAllDay;
    if (dto.startTime !== undefined || dto.isAllDay !== undefined) {
      set('startTime', effectiveAllDay ? null : (dto.startTime ?? existing.startTime));
    }
    if (dto.endTime !== undefined || dto.isAllDay !== undefined) {
      set('endTime', effectiveAllDay ? null : (dto.endTime ?? existing.endTime));
    }
    if (dto.daysOfWeek !== undefined) set('daysOfWeek', dto.daysOfWeek);
    if (dto.timezone !== undefined) set('timezone', dto.timezone);
    if (dto.recurrence !== undefined) set('recurrence', dto.recurrence as Prisma.InputJsonValue);

    if (dto.status !== undefined && dto.status !== existing.status) {
      if (dto.status === ScheduleStatus.ACTIVE) {
        const playlistId = dto.playlistId !== undefined ? dto.playlistId : existing.playlistId;
        await this.assertActivatable(companyId, playlistId, existing.targets.length);
      }
      set('status', dto.status);
      if (dto.status !== ScheduleStatus.ARCHIVED) data.archivedAt = null;
    }

    const schedule = await this.prisma.schedule.update({
      where: { id },
      data,
      include: SCHEDULE_INCLUDE,
    });
    await this.log(actor, companyId, 'schedule.updated', id, { changes: changed });
    return this.toView(schedule);
  }

  async setStatus(companyId: string, actor: AuthenticatedUser, id: string, status: ScheduleStatus) {
    const existing = await this.getScopedOrThrow(companyId, id);
    if (status === ScheduleStatus.ACTIVE) {
      await this.assertActivatable(companyId, existing.playlistId, existing.targets.length);
    }
    const schedule = await this.prisma.schedule.update({
      where: { id },
      data: {
        status,
        archivedAt: status === ScheduleStatus.ARCHIVED ? new Date() : null,
        updatedById: actor.userId,
      },
      include: SCHEDULE_INCLUDE,
    });
    const action =
      status === ScheduleStatus.ACTIVE
        ? 'schedule.resumed'
        : status === ScheduleStatus.PAUSED
          ? 'schedule.paused'
          : 'schedule.archived';
    await this.log(actor, companyId, action, id, { status });
    return this.toView(schedule);
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.schedule.update({
      where: { id },
      data: { deletedAt: new Date(), status: ScheduleStatus.ARCHIVED, updatedById: actor.userId },
    });
    await this.log(actor, companyId, 'schedule.deleted', id);
    return { deleted: true };
  }

  // --- Targets -----------------------------------------------------------

  async addTarget(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: AddScheduleTargetDto,
  ) {
    await this.getScopedOrThrow(companyId, id);
    const [target] = await this.normalizeTargets(companyId, [dto]);
    if (!target) throw new BadRequestException('A valid target is required.');
    const created = await this.prisma.scheduleTarget.upsert({
      where: {
        scheduleId_targetType_targetId: {
          scheduleId: id,
          targetType: target.targetType,
          targetId: target.targetId,
        },
      },
      create: { scheduleId: id, targetType: target.targetType, targetId: target.targetId },
      update: {},
    });
    await this.prisma.schedule.update({ where: { id }, data: { updatedById: actor.userId } });
    await this.log(actor, companyId, 'schedule.target_added', id, {
      targetType: target.targetType,
      targetId: target.targetId,
    });
    void created;
    return this.getDetail(companyId, id);
  }

  async removeTarget(companyId: string, actor: AuthenticatedUser, id: string, targetId: string) {
    const schedule = await this.getScopedOrThrow(companyId, id);
    const target = schedule.targets.find((t) => t.id === targetId);
    if (!target) throw new NotFoundException('Schedule target not found.');
    await this.prisma.scheduleTarget.delete({ where: { id: targetId } });
    await this.prisma.schedule.update({ where: { id }, data: { updatedById: actor.userId } });
    await this.log(actor, companyId, 'schedule.target_removed', id, {
      targetType: target.targetType,
    });
    return this.getDetail(companyId, id);
  }

  // --- Conflicts ---------------------------------------------------------

  /** All overlapping ACTIVE schedule pairs in the company. */
  async conflicts(companyId: string) {
    const index = await this.buildScreenIndex(companyId);
    const schedules = await this.prisma.schedule.findMany({
      where: { companyId, deletedAt: null, status: ScheduleStatus.ACTIVE },
      include: { targets: true },
      take: 500,
    });
    const expanded = schedules.map((s) => ({
      schedule: s,
      screens: expandTargets(s.targets, index),
    }));

    const pairs: Array<{
      a: ReturnType<SchedulesService['conflictSummary']>;
      b: ReturnType<SchedulesService['conflictSummary']>;
      sharedScreenIds: string[];
      winnerId: string;
    }> = [];
    for (let i = 0; i < expanded.length; i++) {
      for (let j = i + 1; j < expanded.length; j++) {
        const a = expanded[i]!;
        const b = expanded[j]!;
        const ca = this.toConflictSchedule(a.schedule);
        const cb = this.toConflictSchedule(b.schedule);
        const { conflicts, sharedScreenIds } = schedulesConflict(ca, a.screens, cb, b.screens);
        if (conflicts) {
          pairs.push({
            a: this.conflictSummary(a.schedule),
            b: this.conflictSummary(b.schedule),
            sharedScreenIds,
            winnerId: pickWinner(ca, cb),
          });
        }
      }
    }
    return { conflicts: pairs };
  }

  /** Conflicts involving one schedule (used by validate). */
  private async conflictsForSchedule(
    companyId: string,
    schedule: ScheduleWithTargets,
    index: ScreenIndex,
  ) {
    const others = await this.prisma.schedule.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: ScheduleStatus.ACTIVE,
        id: { not: schedule.id },
      },
      include: { targets: true },
      take: 500,
    });
    const screensA = expandTargets(schedule.targets, index);
    const ca = this.toConflictSchedule(schedule);
    const out: Array<{
      scheduleId: string;
      name: string;
      sharedScreenIds: string[];
      winnerId: string;
    }> = [];
    for (const other of others) {
      const screensB = expandTargets(other.targets, index);
      const cb = this.toConflictSchedule(other);
      const { conflicts, sharedScreenIds } = schedulesConflict(ca, screensA, cb, screensB);
      if (conflicts) {
        out.push({
          scheduleId: other.id,
          name: other.name,
          sharedScreenIds,
          winnerId: pickWinner(ca, cb),
        });
      }
    }
    return out;
  }

  // --- Helpers -----------------------------------------------------------

  /** Build the in-memory company screen index (id/location/orientation/groups). */
  async buildScreenIndex(companyId: string): Promise<ScreenIndex> {
    const [screens, memberships] = await Promise.all([
      this.prisma.screen.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, locationId: true, orientation: true },
      }),
      this.prisma.screenGroupMember.findMany({
        where: { screen: { companyId, deletedAt: null } },
        select: { screenId: true, groupId: true },
      }),
    ]);
    const groupsByScreen = new Map<string, string[]>();
    const byGroup = new Map<string, string[]>();
    for (const m of memberships) {
      (groupsByScreen.get(m.screenId) ?? groupsByScreen.set(m.screenId, []).get(m.screenId)!).push(
        m.groupId,
      );
      (byGroup.get(m.groupId) ?? byGroup.set(m.groupId, []).get(m.groupId)!).push(m.screenId);
    }
    const byId = new Map<string, IndexedScreen>();
    const byLocation = new Map<string, string[]>();
    const allScreenIds: string[] = [];
    for (const s of screens) {
      allScreenIds.push(s.id);
      byId.set(s.id, {
        id: s.id,
        locationId: s.locationId,
        orientation: s.orientation,
        groupIds: groupsByScreen.get(s.id) ?? [],
      });
      if (s.locationId) {
        (byLocation.get(s.locationId) ?? byLocation.set(s.locationId, []).get(s.locationId)!).push(
          s.id,
        );
      }
    }
    return { allScreenIds, byId, byLocation, byGroup };
  }

  private toConflictSchedule(s: {
    id: string;
    name: string;
    priority: number;
    scheduleType: ScheduleType;
    updatedAt: Date;
    startDate: Date | null;
    endDate: Date | null;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    daysOfWeek: number[];
  }): ConflictSchedule {
    return {
      id: s.id,
      name: s.name,
      priority: s.priority,
      scheduleType: s.scheduleType,
      updatedAt: s.updatedAt,
      startDate: s.startDate,
      endDate: s.endDate,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      daysOfWeek: s.daysOfWeek,
    };
  }

  private conflictSummary(s: {
    id: string;
    name: string;
    priority: number;
    scheduleType: ScheduleType;
  }) {
    return { id: s.id, name: s.name, priority: s.priority, scheduleType: s.scheduleType };
  }

  /** Orientation mismatch warnings between the schedule's playlist and its targeted screens. */
  private async orientationWarnings(
    companyId: string,
    schedule: ScheduleWithTargets,
    index: ScreenIndex,
  ): Promise<string[]> {
    if (!schedule.playlistId) return [];
    const playlist = await this.playlists
      .getDetail(companyId, schedule.playlistId)
      .catch(() => null);
    if (!playlist) return [];
    const profile = playlist.orientationProfile;
    if (profile === 'UNKNOWN') return [];

    const screenIds = expandTargets(schedule.targets, index);
    const orientations = new Set<Orientation>();
    for (const id of screenIds) {
      const screen = index.byId.get(id);
      if (screen && screen.orientation !== Orientation.UNKNOWN)
        orientations.add(screen.orientation);
    }
    const warnings: string[] = [];
    for (const orientation of orientations) {
      const warning = orientationWarning(profile, orientation);
      if (warning) warnings.push(warning);
    }
    return [...new Set(warnings)];
  }

  private async assertPlaylist(companyId: string, playlistId: string) {
    await this.playlists.getScopedOrThrow(companyId, playlistId);
  }

  /** A schedule may only be ACTIVE with a valid playlist and ≥1 target. */
  private async assertActivatable(
    companyId: string,
    playlistId: string | null,
    targetCount: number,
  ) {
    if (!playlistId) {
      throw new BadRequestException('Assign a playlist before activating the schedule.');
    }
    const validity = await this.playlists.validate(companyId, playlistId);
    if (!validity.schedulable) {
      throw new BadRequestException(
        'The assigned playlist has no valid items; it cannot be scheduled.',
      );
    }
    if (targetCount < 1) {
      throw new BadRequestException('Add at least one target before activating the schedule.');
    }
  }

  private validateTiming(t: {
    startDate?: string | null;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    isAllDay?: boolean | null;
  }): void {
    if (!t.startDate) throw new BadRequestException('startDate is required.');
    if (t.endDate && new Date(t.endDate) < new Date(t.startDate)) {
      throw new BadRequestException('endDate must be on or after startDate.');
    }
    if (!t.isAllDay && (!t.startTime || !t.endTime)) {
      throw new BadRequestException(
        'startTime and endTime are required unless the schedule is all-day.',
      );
    }
  }

  /** Validate + normalize targets (COMPANY uses companyId as its targetId). */
  private async normalizeTargets(
    companyId: string,
    targets: ScheduleTargetInputDto[],
  ): Promise<Array<{ targetType: ScheduleTargetType; targetId: string }>> {
    const out: Array<{ targetType: ScheduleTargetType; targetId: string }> = [];
    const seen = new Set<string>();
    for (const target of targets) {
      const targetId =
        target.targetType === ScheduleTargetType.COMPANY
          ? companyId
          : (target.targetId ?? '').trim();
      if (target.targetType !== ScheduleTargetType.COMPANY && !targetId) {
        throw new BadRequestException(`targetId is required for ${target.targetType} targets.`);
      }
      await this.assertTarget(companyId, target.targetType, targetId);
      const key = `${target.targetType}:${targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ targetType: target.targetType, targetId });
      }
    }
    return out;
  }

  private async assertTarget(
    companyId: string,
    type: ScheduleTargetType,
    targetId: string,
  ): Promise<void> {
    if (type === ScheduleTargetType.COMPANY) {
      if (targetId !== companyId)
        throw new BadRequestException('Company target must reference your own company.');
      return;
    }
    if (type === ScheduleTargetType.SCREEN) {
      const screen = await this.prisma.screen.findFirst({
        where: { id: targetId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!screen)
        throw new BadRequestException('Target screen is invalid or not in this company.');
      return;
    }
    if (type === ScheduleTargetType.SCREEN_GROUP) {
      const group = await this.prisma.screenGroup.findFirst({
        where: { id: targetId, companyId },
        select: { id: true },
      });
      if (!group)
        throw new BadRequestException('Target screen group is invalid or not in this company.');
      return;
    }
    if (type === ScheduleTargetType.LOCATION) {
      const location = await this.prisma.location.findFirst({
        where: { id: targetId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!location)
        throw new BadRequestException('Target location is invalid or not in this company.');
      return;
    }
  }

  private orderBy(sort?: string): Prisma.ScheduleOrderByWithRelationInput {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'name':
        return { name: 'asc' };
      case 'priority':
        return { priority: 'desc' };
      case 'updated':
        return { updatedAt: 'desc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  private toView(schedule: ScheduleWithTargets) {
    return {
      id: schedule.id,
      companyId: schedule.companyId,
      name: schedule.name,
      description: schedule.description,
      playlistId: schedule.playlistId,
      playlist: schedule.playlist
        ? {
            id: schedule.playlist.id,
            title: schedule.playlist.title,
            status: schedule.playlist.status,
          }
        : null,
      status: schedule.status,
      scheduleType: schedule.scheduleType,
      priority: schedule.priority,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      isAllDay: schedule.isAllDay,
      daysOfWeek: schedule.daysOfWeek,
      timezone: schedule.timezone,
      recurrence: schedule.recurrence,
      createdById: schedule.createdById,
      updatedById: schedule.updatedById,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      archivedAt: schedule.archivedAt,
      targets: schedule.targets.map((t) => ({
        id: t.id,
        targetType: t.targetType,
        targetId: t.targetId,
      })),
      targetCount: schedule.targets.length,
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
      targetType: 'schedule',
      targetId,
      metadata,
    });
  }
}
