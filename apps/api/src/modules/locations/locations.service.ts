import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, LocationStatus, Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { UsageLimitsService } from '../usage-limits/usage-limits.service';
import type {
  CreateLocationDto,
  ListLocationsQueryDto,
  UpdateLocationDto,
} from './dto/location.dto';

export interface ScreenMetrics {
  total: number;
  online: number;
  offline: number;
  warning: number;
  other: number;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly usageLimits: UsageLimitsService,
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

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateLocationDto) {
    // Enforce the plan's location limit (grace-aware).
    await this.usageLimits.assertCanAdd(companyId, 'locations');
    if (dto.fallbackContentId) await this.assertFallback(companyId, dto.fallbackContentId);

    const location = await this.prisma.location.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code ?? null,
        description: dto.description,
        address: dto.address,
        city: dto.city,
        region: dto.region,
        country: dto.country,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timezone: dto.timezone,
        notes: dto.notes,
        status: dto.status ?? LocationStatus.ACTIVE,
        workingHours: (dto.workingHours ?? undefined) as Prisma.InputJsonValue | undefined,
        fallbackContentId: dto.fallbackContentId?.trim() || null,
      },
    });

    await this.log(actor, companyId, 'location.created', location.id, { name: location.name });
    return location;
  }

  async list(companyId: string, query: ListLocationsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.LocationWhereInput = { companyId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const orderBy: Prisma.LocationOrderByWithRelationInput = {
      [query.sort ?? 'createdAt']: query.order ?? 'desc',
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { _count: { select: { screens: true } } },
      }),
      this.prisma.location.count({ where }),
    ]);
    const items = rows.map((l) => ({ ...l, screenCount: l._count.screens }));
    return { items, meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }

  async getDetail(companyId: string, id: string) {
    const location = await this.getScopedOrThrow(companyId, id);
    const metrics = await this.screenMetrics(companyId, id);
    return { ...location, metrics };
  }

  /** Screen status breakdown for a company (optionally one location). */
  async screenMetrics(companyId: string, locationId?: string): Promise<ScreenMetrics> {
    const where: Prisma.ScreenWhereInput = { companyId, deletedAt: null };
    if (locationId) where.locationId = locationId;
    const groups = await this.prisma.screen.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });
    const count = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    const online = count('ONLINE');
    const offline = count('OFFLINE');
    const warning = count('WARNING');
    return { total, online, offline, warning, other: total - online - offline - warning };
  }

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateLocationDto) {
    await this.getScopedOrThrow(companyId, id);
    const data: Prisma.LocationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.region !== undefined) data.region = dto.region;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.fallbackContentId !== undefined) {
      const fallback = dto.fallbackContentId?.trim() || null;
      if (fallback) await this.assertFallback(companyId, fallback);
      data.fallbackContentId = fallback;
    }
    if (dto.workingHours !== undefined)
      data.workingHours = dto.workingHours as Prisma.InputJsonValue;

    const location = await this.prisma.location.update({ where: { id }, data });
    await this.log(actor, companyId, 'location.updated', id, { changes: Object.keys(data) });
    return location;
  }

  async setStatus(companyId: string, actor: AuthenticatedUser, id: string, status: LocationStatus) {
    const existing = await this.getScopedOrThrow(companyId, id);
    // Reactivating an archived location re-consumes quota — enforce the plan limit.
    if (existing.status === LocationStatus.ARCHIVED && status !== LocationStatus.ARCHIVED) {
      await this.usageLimits.assertCanAdd(companyId, 'locations');
    }
    const location = await this.prisma.location.update({ where: { id }, data: { status } });
    const action =
      status === LocationStatus.ARCHIVED
        ? 'location.archived'
        : status === LocationStatus.ACTIVE
          ? 'location.reactivated'
          : 'location.deactivated';
    await this.log(actor, companyId, action, id, { status });
    return location;
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    // Unassign screens, then soft-delete the location.
    await this.prisma.screen.updateMany({
      where: { companyId, locationId: id },
      data: { locationId: null },
    });
    await this.prisma.location.update({
      where: { id },
      data: { deletedAt: new Date(), status: LocationStatus.ARCHIVED },
    });
    await this.log(actor, companyId, 'location.deleted', id);
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
      targetType: 'location',
      targetId,
      metadata,
    });
  }
}
