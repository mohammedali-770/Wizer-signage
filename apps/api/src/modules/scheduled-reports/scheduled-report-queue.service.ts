import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class ScheduledReportQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async queue(companyId: string, actor: AuthenticatedUser, id: string) {
    const report = await this.prisma.scheduledReport.findFirst({
      where: { id, companyId },
      select: { id: true, enabled: true },
    });
    if (!report) throw new NotFoundException('Scheduled report not found.');
    if (!report.enabled) {
      throw new BadRequestException('Enable this scheduled report before queueing a manual run.');
    }

    const queuedAt = new Date();
    await this.prisma.scheduledReport.update({
      where: { id },
      data: { nextRunAt: queuedAt },
    });
    await this.activityLog.log({
      action: 'report.scheduled_run_queued',
      category: 'REPORT',
      actorId: actor.userId,
      companyId,
      targetType: 'scheduled_report',
      targetId: id,
      metadata: { queuedAt: queuedAt.toISOString() } as Prisma.InputJsonValue,
    });
    return { accepted: true as const, scheduledReportId: id, queuedAt: queuedAt.toISOString() };
  }
}
