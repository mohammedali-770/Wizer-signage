import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TagType } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import type { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateTagDto) {
    const tag = await this.prisma.tag.create({
      data: {
        companyId,
        name: dto.name,
        type: dto.type ?? TagType.SCREEN,
        color: dto.color,
        description: dto.description,
      },
    });
    await this.log(actor, companyId, 'tag.created', tag.id, { name: tag.name, type: tag.type });
    return tag;
  }

  async list(companyId: string, query: ListTagsQueryDto) {
    if (query.type && query.applicableTo) {
      throw new BadRequestException(
        'Use either type or applicableTo when filtering tags, not both.',
      );
    }

    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.TagWhereInput = { companyId };
    if (query.type) {
      where.type = query.type;
    } else if (query.applicableTo === 'SCREEN') {
      where.type = { in: [TagType.SCREEN, TagType.BOTH] };
    } else if (query.applicableTo === 'CONTENT') {
      where.type = { in: [TagType.CONTENT, TagType.BOTH] };
    }
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
        include: { _count: { select: { screens: true } } },
      }),
      this.prisma.tag.count({ where }),
    ]);
    const items = rows.map((t) => ({ ...t, screenCount: t._count.screens }));
    return { items, meta: meta(total) };
  }

  async getScopedOrThrow(companyId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, companyId } });
    if (!tag) throw new NotFoundException('Tag not found.');
    return tag;
  }

  async update(companyId: string, actor: AuthenticatedUser, id: string, dto: UpdateTagDto) {
    await this.getScopedOrThrow(companyId, id);
    const data: Prisma.TagUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.description !== undefined) data.description = dto.description;
    const tag = await this.prisma.tag.update({ where: { id }, data });
    await this.log(actor, companyId, 'tag.updated', id, { changes: Object.keys(data) });
    return tag;
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.getScopedOrThrow(companyId, id);
    await this.prisma.tag.delete({ where: { id } }); // screen/content tag links cascade
    await this.log(actor, companyId, 'tag.deleted', id);
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
      targetType: 'tag',
      targetId,
      metadata,
    });
  }
}
