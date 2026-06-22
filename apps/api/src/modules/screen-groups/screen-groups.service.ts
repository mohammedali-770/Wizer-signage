import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import type {
  CreateScreenGroupDto,
  ListScreenGroupsQueryDto,
  UpdateScreenGroupDto,
} from './dto/screen-group.dto';

@Injectable()
export class ScreenGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateScreenGroupDto) {
    const group = await this.prisma.screenGroup.create({
      data: { companyId, name: dto.name, description: dto.description, category: dto.category },
    });
    await this.log(actor, companyId, 'screen_group.created', group.id, { name: group.name });
    return group;
  }

  async list(companyId: string, query: ListScreenGroupsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ScreenGroupWhereInput = { companyId };
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.screenGroup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { members: true } } },
      }),
      this.prisma.screenGroup.count({ where }),
    ]);
    const items = rows.map((g) => ({ ...g, screenCount: g._count.members }));
    return { items, meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string) {
    const group = await this.prisma.screenGroup.findFirst({ where: { id, companyId } });
    if (!group) throw new NotFoundException('Screen group not found.');
    return group;
  }

  async getDetail(companyId: string, id: string) {
    const group = await this.getScopedOrThrow(companyId, id);
    // Exclude soft-deleted screens (membership rows persist after a screen is deleted).
    const members = await this.prisma.screenGroupMember.findMany({
      where: { groupId: id, screen: { deletedAt: null } },
      include: { screen: { select: { id: true, name: true, status: true, locationId: true } } },
    });
    return { ...group, screens: members.map((m) => m.screen) };
  }

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateScreenGroupDto) {
    await this.getScopedOrThrow(companyId, id);
    const data: Prisma.ScreenGroupUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    const group = await this.prisma.screenGroup.update({ where: { id }, data });
    await this.log(actor, companyId, 'screen_group.updated', id, { changes: Object.keys(data) });
    return group;
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.screenGroup.delete({ where: { id } }); // memberships cascade
    await this.log(actor, companyId, 'screen_group.deleted', id);
  }

  async addScreens(companyId: string, actor: AuthenticatedUser, id: string, screenIds: string[]) {
    await this.getScopedOrThrow(companyId, id);
    const valid = await this.validScreenIds(companyId, screenIds);
    await this.prisma.screenGroupMember.createMany({
      data: valid.map((screenId) => ({ groupId: id, screenId })),
      skipDuplicates: true,
    });
    await this.log(actor, companyId, 'screen_group.screens_added', id, { count: valid.length });
    return this.getDetail(companyId, id);
  }

  async removeScreens(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    screenIds: string[],
  ) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.screenGroupMember.deleteMany({
      where: { groupId: id, screenId: { in: screenIds } },
    });
    await this.log(actor, companyId, 'screen_group.screens_removed', id, {
      count: screenIds.length,
    });
    return this.getDetail(companyId, id);
  }

  private async validScreenIds(companyId: string, screenIds: string[]): Promise<string[]> {
    const unique = [...new Set(screenIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.screen.findMany({
      where: { id: { in: unique }, companyId, deletedAt: null },
      select: { id: true },
    });
    if (rows.length !== unique.length)
      throw new BadRequestException('One or more screens are invalid.');
    return rows.map((r) => r.id);
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
      targetType: 'screen_group',
      targetId,
      metadata,
    });
  }
}
