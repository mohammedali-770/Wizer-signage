import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ReportDeliveryStatus, ReportFormat, ReportFrequency } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import {
  ExportService,
  REPORT_TYPE_DATASET,
  type ExportFilters,
  type ExportFormat,
} from '../exports/export.service';
import { AlertService } from '../notifications/alert.service';
import { EmailService } from '../notifications/email.service';
import { AlertEvent } from '../notifications/notifications.constants';
import { StorageService } from '../storage/storage.service';
import type {
  CreateScheduledReportDto,
  ListScheduledReportsQueryDto,
  UpdateScheduledReportDto,
} from './dto/scheduled-report.dto';

const REPORT_SIGNED_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Scheduled reports (Phase 10). Definitions are CRUD-managed here; execution is
 * driven by a simple due-runner (`runDue`) invoked by the maintenance CLI/cron —
 * not an in-process scheduler. Each run renders via the shared ExportService,
 * stores the file, emails recipients a signed link, and records a delivery.
 */
@Injectable()
export class ScheduledReportService {
  private readonly logger = new Logger(ScheduledReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly exports: ExportService,
    private readonly email: EmailService,
    private readonly alerts: AlertService,
    private readonly storage: StorageService,
  ) {}

  // --- CRUD --------------------------------------------------------------

  async create(companyId: string, actor: AuthenticatedUser, dto: CreateScheduledReportDto) {
    const report = await this.prisma.scheduledReport.create({
      data: {
        companyId,
        name: dto.name,
        reportType: dto.reportType,
        format: dto.format ?? ReportFormat.CSV,
        frequency: dto.frequency,
        recipients: dto.recipients as unknown as Prisma.InputJsonValue,
        filters: (dto.filters ?? {}) as Prisma.InputJsonValue,
        enabled: true,
        nextRunAt: this.nextRunAt(dto.frequency),
        createdById: actor.userId,
      },
    });
    await this.log(actor, companyId, 'report.scheduled_created', report.id, {
      reportType: dto.reportType,
    });
    return this.toView(report);
  }

  async list(companyId: string, query: ListScheduledReportsQueryDto) {
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ScheduledReportWhereInput = { companyId };
    if (query.reportType) where.reportType = query.reportType;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.scheduledReport.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.scheduledReport.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total) };
  }

  async get(companyId: string, id: string) {
    const report = await this.loadOwned(companyId, id);
    const deliveries = await this.prisma.scheduledReportDelivery.findMany({
      where: { scheduledReportId: id, companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { ...this.toView(report), deliveries: deliveries.map((d) => this.deliveryView(d)) };
  }

  async update(
    companyId: string,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateScheduledReportDto,
  ) {
    const report = await this.loadOwned(companyId, id);
    const frequency = dto.frequency ?? report.frequency;
    const updated = await this.prisma.scheduledReport.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        reportType: dto.reportType ?? undefined,
        format: dto.format ?? undefined,
        frequency: dto.frequency ?? undefined,
        recipients: dto.recipients
          ? (dto.recipients as unknown as Prisma.InputJsonValue)
          : undefined,
        filters: dto.filters ? (dto.filters as Prisma.InputJsonValue) : undefined,
        enabled: dto.enabled ?? undefined,
        // Recompute the next run when cadence changes.
        nextRunAt:
          dto.frequency && dto.frequency !== report.frequency
            ? this.nextRunAt(frequency)
            : undefined,
      },
    });
    await this.log(actor, companyId, 'report.scheduled_updated', id, {});
    return this.toView(updated);
  }

  async setEnabled(companyId: string, actor: AuthenticatedUser, id: string, enabled: boolean) {
    await this.loadOwned(companyId, id);
    const updated = await this.prisma.scheduledReport.update({
      where: { id },
      data: { enabled, nextRunAt: enabled ? this.nextRunAt() : null },
    });
    await this.log(
      actor,
      companyId,
      enabled ? 'report.scheduled_enabled' : 'report.scheduled_disabled',
      id,
      {},
    );
    return this.toView(updated);
  }

  async remove(companyId: string, actor: AuthenticatedUser, id: string) {
    await this.loadOwned(companyId, id);
    await this.prisma.scheduledReport.delete({ where: { id } });
    await this.log(actor, companyId, 'report.scheduled_deleted', id, {});
    return { ok: true };
  }

  // --- Execution ----------------------------------------------------------

  /** Run a single report now (manual trigger). */
  async runNow(companyId: string, actor: AuthenticatedUser, id: string) {
    const report = await this.loadOwned(companyId, id);
    const delivery = await this.run(report);
    await this.log(actor, companyId, 'report.scheduled_run', id, {
      deliveryId: delivery.id,
      status: delivery.status,
    });
    return this.deliveryView(delivery);
  }

  /** Maintenance hook: run every enabled report whose nextRunAt is due. */
  async runDue(now: Date = new Date()): Promise<{ ran: number; failed: number }> {
    const due = await this.prisma.scheduledReport.findMany({
      where: { enabled: true, nextRunAt: { not: null, lte: now } },
      take: 200,
    });
    let ran = 0;
    let failed = 0;
    for (const report of due) {
      const delivery = await this.run(report, now);
      ran++;
      if (delivery.status === ReportDeliveryStatus.FAILED) failed++;
    }
    return { ran, failed };
  }

  /** Render → store → email → record. Never throws (records FAILED + alerts). */
  private async run(report: Prisma.ScheduledReportGetPayload<true>, now: Date = new Date()) {
    const recipients = (report.recipients as unknown as string[]) ?? [];
    const delivery = await this.prisma.scheduledReportDelivery.create({
      data: {
        companyId: report.companyId,
        scheduledReportId: report.id,
        status: ReportDeliveryStatus.PENDING,
        recipientEmails: recipients as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const dataset = REPORT_TYPE_DATASET[report.reportType];
      if (!dataset) throw new Error(`No dataset mapping for ${report.reportType}.`);
      const data = await this.exports.dataset(
        { companyId: report.companyId, isSuperAdmin: false },
        dataset,
        report.filters as ExportFilters,
      );
      const rendered = await this.exports.render(
        data,
        report.format as ExportFormat,
        `${report.reportType.toLowerCase()}-report`,
        now,
      );

      const key = `companies/${report.companyId}/reports/${report.id}/${rendered.filename}`;
      const buffer =
        typeof rendered.body === 'string' ? Buffer.from(rendered.body, 'utf-8') : rendered.body;
      await this.storage.upload(key, buffer, rendered.contentType);
      const url = await this.storage
        .getSignedUrl(key, rendered.contentType, REPORT_SIGNED_TTL_SECONDS)
        .catch(() => null);

      let okCount = 0;
      for (const to of recipients) {
        const result = await this.email.sendEvent({
          companyId: report.companyId,
          to,
          type: 'report',
          subject: `Scheduled report: ${report.name}`,
          text:
            `Your "${report.name}" report (${report.reportType}, ${report.format}) is ready with ${data.rows.length} rows.\n\n` +
            (url
              ? `Download (link valid 7 days):\n${url}\n`
              : 'The report was generated and stored.'),
        });
        if (result.ok) okCount++;
      }

      // The report rendered + stored, but if every recipient email failed the
      // delivery did NOT reach anyone — record it FAILED and alert.
      const allEmailsFailed = recipients.length > 0 && okCount === 0;
      const done = await this.prisma.scheduledReportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: allEmailsFailed ? ReportDeliveryStatus.FAILED : ReportDeliveryStatus.SENT,
          fileStorageKey: key,
          error: allEmailsFailed ? 'All recipient emails failed to send.' : null,
          sentAt: allEmailsFailed ? null : new Date(),
        },
      });
      await this.prisma.scheduledReport.update({
        where: { id: report.id },
        data: { lastRunAt: now, nextRunAt: this.nextRunAt(report.frequency, now) },
      });
      if (allEmailsFailed) {
        await this.alerts
          .raise({
            companyId: report.companyId,
            type: AlertEvent.ReportFailed,
            title: `Scheduled report not delivered: ${report.name}`,
            message: 'The report generated but all recipient emails failed.',
            metadata: { scheduledReportId: report.id },
            dedupeKey: `${report.companyId}:report:${report.id}:undelivered`,
          })
          .catch(() => undefined);
      }
      return done;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Scheduled report ${report.id} failed: ${message}`);
      const failed = await this.prisma.scheduledReportDelivery.update({
        where: { id: delivery.id },
        data: { status: ReportDeliveryStatus.FAILED, error: message },
      });
      // Advance nextRunAt so a permanently-broken report does not block the runner.
      await this.prisma.scheduledReport
        .update({
          where: { id: report.id },
          data: { lastRunAt: now, nextRunAt: this.nextRunAt(report.frequency, now) },
        })
        .catch(() => undefined);
      await this.alerts
        .raise({
          companyId: report.companyId,
          type: AlertEvent.ReportFailed,
          title: `Scheduled report failed: ${report.name}`,
          message,
          metadata: { scheduledReportId: report.id },
          dedupeKey: `${report.companyId}:report:${report.id}:failed`,
        })
        .catch(() => undefined);
      return failed;
    }
  }

  // --- Helpers -----------------------------------------------------------

  /** Next run time for a cadence. Deterministic, no in-process timers. */
  private nextRunAt(
    frequency: ReportFrequency = ReportFrequency.WEEKLY,
    from: Date = new Date(),
  ): Date {
    const next = new Date(from);
    if (frequency === ReportFrequency.DAILY) next.setUTCDate(next.getUTCDate() + 1);
    else if (frequency === ReportFrequency.WEEKLY) next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private async loadOwned(companyId: string, id: string) {
    const report = await this.prisma.scheduledReport.findFirst({ where: { id, companyId } });
    if (!report) throw new NotFoundException('Scheduled report not found.');
    return report;
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
      category: 'REPORT',
      actorId: actor.userId,
      companyId,
      targetType: 'scheduled_report',
      targetId: id,
      metadata,
    });
  }

  private toView(r: Prisma.ScheduledReportGetPayload<true>) {
    return {
      id: r.id,
      name: r.name,
      reportType: r.reportType,
      format: r.format,
      frequency: r.frequency,
      recipients: r.recipients,
      filters: r.filters,
      enabled: r.enabled,
      lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
      nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private deliveryView(d: Prisma.ScheduledReportDeliveryGetPayload<true>) {
    return {
      id: d.id,
      status: d.status,
      recipientEmails: d.recipientEmails,
      fileStorageKey: d.fileStorageKey,
      error: d.error,
      sentAt: d.sentAt ? d.sentAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
