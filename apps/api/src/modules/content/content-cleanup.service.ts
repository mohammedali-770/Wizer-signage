import { Injectable, Logger } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';
import { TRASH_RETENTION_DAYS } from '@wizer/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { ActivityCategory, ActivityLogService } from '../activity-log/activity-log.service';
import { StorageService } from '../storage/storage.service';

/**
 * Trash-retention cleanup. Permanently removes content that has been in TRASH
 * longer than the retention window (14 days): deletes the storage file and marks
 * the row DELETED + deletedAt (kept as a tombstone for audit). A scheduled job
 * calls {@link purgeExpiredTrash} platform-wide; the Company console can purge
 * its own eligible trash on demand.
 */
@Injectable()
export class ContentCleanupService {
  private readonly logger = new Logger(ContentCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async purgeExpiredTrash(companyId?: string): Promise<number> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);
    const where: Prisma.ContentWhereInput = {
      status: ContentStatus.TRASH,
      trashedAt: { lt: cutoff },
      deletedAt: null,
      ...(companyId ? { companyId } : {}),
    };
    const items = await this.prisma.content.findMany({
      where,
      select: { id: true, companyId: true, storageKey: true },
    });

    let purged = 0;
    for (const item of items) {
      // One bad row must not abort the whole batch.
      try {
        if (item.storageKey) {
          await this.storage
            .remove(item.storageKey)
            .catch((e) => this.logger.warn(`Failed to remove file for ${item.id}: ${String(e)}`));
        }
        await this.prisma.content.update({
          where: { id: item.id },
          data: { status: ContentStatus.DELETED, deletedAt: new Date() },
        });
        await this.activityLog.log({
          action: 'content.cleanup_deleted',
          category: ActivityCategory.COMPANY,
          companyId: item.companyId,
          targetType: 'content',
          targetId: item.id,
          metadata: { reason: 'trash_retention_elapsed' },
        });
        purged += 1;
      } catch (e) {
        this.logger.warn(`Cleanup failed for content ${item.id}: ${String(e)}`);
      }
    }
    if (purged) this.logger.log(`Purged ${purged} expired-trash content item(s).`);
    return purged;
  }
}
