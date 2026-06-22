import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import type { CreateInvoiceDto, ListInvoicesQueryDto } from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateInvoiceDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found.');

    if (dto.subscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { id: dto.subscriptionId, companyId: dto.companyId },
      });
      if (!subscription) {
        throw new BadRequestException('Subscription does not belong to this company.');
      }
    }

    const subtotal = round2(dto.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0));
    const tax = round2(dto.tax ?? 0);
    const total = round2(subtotal + tax);
    const status = dto.status ?? InvoiceStatus.DRAFT;
    const now = new Date();

    const invoice = await this.createWithUniqueNumber((number) => ({
      number,
      companyId: dto.companyId,
      subscriptionId: dto.subscriptionId ?? null,
      status,
      currency: dto.currency ?? 'USD',
      subtotal,
      tax,
      total,
      lineItems: dto.lineItems as unknown as Prisma.InputJsonValue,
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : status === InvoiceStatus.DRAFT ? null : now,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      paidAt: status === InvoiceStatus.PAID ? now : null,
    }));

    await this.activityLog.log({
      action: 'invoice.created',
      category: ActivityCategory.INVOICE,
      actorId: actor.userId,
      companyId: dto.companyId,
      targetType: 'invoice',
      targetId: invoice.id,
      metadata: { number: invoice.number, total, status },
    });
    return invoice;
  }

  async list(query: ListInvoicesQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.InvoiceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: { company: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items, meta: meta(total) };
  }

  async getByIdOrThrow(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true, slug: true } }, subscription: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async updateStatus(actor: AuthenticatedUser, id: string, status: InvoiceStatus) {
    const existing = await this.getByIdOrThrow(id);
    const now = new Date();
    const data: Prisma.InvoiceUpdateInput = { status };
    if (status === InvoiceStatus.PAID) data.paidAt = now;
    if (status !== InvoiceStatus.DRAFT && !existing.issuedAt) data.issuedAt = now;

    const invoice = await this.prisma.invoice.update({ where: { id }, data });
    await this.activityLog.log({
      action: 'invoice.status_changed',
      category: ActivityCategory.INVOICE,
      actorId: actor.userId,
      companyId: existing.companyId,
      targetType: 'invoice',
      targetId: id,
      metadata: { from: existing.status, to: status, number: existing.number },
    });
    return invoice;
  }

  /**
   * Next sequence for the year from the actual high-water mark (max existing
   * suffix), so cancellations/skips never regenerate a used number. The fixed
   * 5-digit zero-padding makes a lexical `number desc` order numerically correct.
   */
  private async nextSequence(year: number): Promise<number> {
    const prefix = `INV-${year}-`;
    const latest = await this.prisma.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    if (!latest) return 1;
    const suffix = Number.parseInt(latest.number.slice(prefix.length), 10);
    return (Number.isNaN(suffix) ? 0 : suffix) + 1;
  }

  /** Sequential, year-scoped invoice number with collision retry. */
  private async createWithUniqueNumber(
    build: (number: string) => Prisma.InvoiceUncheckedCreateInput,
  ) {
    const year = new Date().getFullYear();
    const base = await this.nextSequence(year);
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = `INV-${year}-${String(base + attempt).padStart(5, '0')}`;
      try {
        return await this.prisma.invoice.create({ data: build(number) });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue; // number collision — retry with the next sequence
        }
        throw error;
      }
    }
    throw new BadRequestException('Could not allocate an invoice number. Try again.');
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
