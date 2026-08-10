import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, ContentType, Prisma, ScheduleStatus } from '@prisma/client';
import type { Response } from 'express';

import { localMoment, type LocalMoment } from '../../common/scheduling/schedule-time.util';
import {
  type ConflictSchedule,
  scheduleActiveAt,
  screenMatchesTargets,
  type TargetRef,
} from '../schedules/schedule-targeting';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const PRE_DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;
const SAMPLE_STEP_MS = 60 * 1000;
const ENTITLEMENT_CACHE_BUCKET_MS = 60 * 1000;

const ENTITLE_SELECT = {
  id: true,
  type: true,
  title: true,
  orientation: true,
  status: true,
  expiresAt: true,
  durationSeconds: true,
  pageCount: true,
  mimeType: true,
  fileSize: true,
  checksum: true,
  storageKey: true,
  url: true,
  textBody: true,
  updatedAt: true,
} satisfies Prisma.ContentSelect;

type EntitledContent = Prisma.ContentGetPayload<{ select: typeof ENTITLE_SELECT }>;

type EntitlementCacheEntry = {
  minute: number;
  promise: Promise<Map<string, EntitledContent>>;
};

/**
 * Server-side entitlement + offline-asset access for a paired device (Phase 7).
 *
 * A device may only ever read content that is **entitled to its own screen**:
 * the current manifest, any schedule that could play within the pre-download
 * window, or the screen → location → company fallback — and only while that
 * content is ACTIVE and not expired/archived/trashed/deleted. companyId/screenId
 * come from the verified device token, never from the request; an arbitrary
 * contentId is rejected unless it is in the entitled set.
 */
@Injectable()
export class DeviceContentService {
  /**
   * One current promise per screen. Range requests for the same large asset often
   * arrive concurrently; caching the promise coalesces those requests instead of
   * evaluating up to 500 schedules × 61 minute samples for every range.
   *
   * Entries naturally replace once per minute, matching scheduling resolution.
   * The key includes companyId even though screen IDs are globally unique so the
   * tenant boundary remains explicit in this security-sensitive cache.
   */
  private readonly entitlementCache = new Map<string, EntitlementCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getSyncPlan(device: AuthenticatedDevice) {
    const entitled = await this.entitledContent(device);
    const items = [...entitled.values()].map((c) => this.toSyncItem(c));
    return {
      screenId: device.screenId,
      generatedAt: new Date().toISOString(),
      preDownloadWindowSeconds: Math.floor(PRE_DOWNLOAD_WINDOW_MS / 1000),
      items,
    };
  }

  async download(
    device: AuthenticatedDevice,
    contentId: string,
    range: string | undefined,
    res: Response,
  ) {
    const entitled = await this.entitledContent(device);
    const content = entitled.get(contentId);
    if (!content || !content.storageKey || !this.isFileType(content.type)) {
      throw new NotFoundException('Content is not available for this screen.');
    }
    await this.storage.streamContent({
      key: content.storageKey,
      mimeType: content.mimeType ?? 'application/octet-stream',
      range,
      res,
    });
  }

  private entitledContent(device: AuthenticatedDevice): Promise<Map<string, EntitledContent>> {
    const minute = Math.floor(Date.now() / ENTITLEMENT_CACHE_BUCKET_MS);
    const key = `${device.companyId}:${device.screenId}`;
    const cached = this.entitlementCache.get(key);
    if (cached?.minute === minute) return cached.promise;

    const promise = this.computeEntitledContent(device);
    this.entitlementCache.set(key, { minute, promise });

    // A transient DB/storage failure must never poison the screen for the rest
    // of the minute. Remove only if this exact promise is still the active entry.
    void promise.catch(() => {
      if (this.entitlementCache.get(key)?.promise === promise) {
        this.entitlementCache.delete(key);
      }
    });

    return promise;
  }

  /**
   * Compute the set of content entitled to the device's screen right now and
   * within the pre-download window. Always same-company + ACTIVE + non-expired.
   */
  private async computeEntitledContent(
    device: AuthenticatedDevice,
  ): Promise<Map<string, EntitledContent>> {
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId, deletedAt: null },
      include: {
        location: { select: { timezone: true, workingHours: true, fallbackContentId: true } },
        company: { select: { timezone: true } },
        groups: { select: { groupId: true } },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const tz =
      (screen.workingHours as { timezone?: string } | null)?.timezone ||
      screen.location?.timezone ||
      screen.company?.timezone ||
      'UTC';
    const indexedScreen = {
      id: screen.id,
      locationId: screen.locationId,
      orientation: screen.orientation,
      groupIds: screen.groups.map((g) => g.groupId),
    };

    const schedules = await this.prisma.schedule.findMany({
      where: {
        companyId: device.companyId,
        deletedAt: null,
        status: ScheduleStatus.ACTIVE,
        playlistId: { not: null },
      },
      include: { targets: true, playlist: { select: { id: true, status: true, deletedAt: true } } },
      take: 500,
    });

    const now = Date.now();
    const samples: Date[] = [];
    for (let offset = 0; offset <= PRE_DOWNLOAD_WINDOW_MS; offset += SAMPLE_STEP_MS) {
      samples.push(new Date(now + offset));
    }
    const momentsByTz = new Map<string, LocalMoment[]>();
    const momentsFor = (zone: string): LocalMoment[] => {
      let arr = momentsByTz.get(zone);
      if (!arr) {
        arr = samples.map((s) => localMoment(s, zone));
        momentsByTz.set(zone, arr);
      }
      return arr;
    };

    const playlistIds = new Set<string>();
    for (const s of schedules) {
      if (!s.playlistId || !s.playlist || s.playlist.deletedAt || s.playlist.status !== 'ACTIVE')
        continue;
      if (!screenMatchesTargets(indexedScreen, s.targets as TargetRef[])) continue;
      const conflict = this.toConflict(s);
      const moments = momentsFor(s.timezone || tz);
      if (moments.some((m) => scheduleActiveAt(conflict, m.ymd, m.weekday, m.hhmm))) {
        playlistIds.add(s.playlistId);
      }
    }

    const playlistItems = playlistIds.size
      ? await this.prisma.playlistItem.findMany({
          where: { playlistId: { in: [...playlistIds] } },
          select: { contentId: true },
        })
      : [];

    const fallbackIds = [
      screen.fallbackContentId,
      screen.location?.fallbackContentId ?? null,
      await this.companyFallbackId(device.companyId),
    ].filter((id): id is string => !!id);

    const contentIds = new Set<string>([...playlistItems.map((i) => i.contentId), ...fallbackIds]);
    if (contentIds.size === 0) return new Map();

    const rows = await this.prisma.content.findMany({
      where: {
        id: { in: [...contentIds] },
        companyId: device.companyId,
        deletedAt: null,
        status: ContentStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: ENTITLE_SELECT,
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async companyFallbackId(companyId: string): Promise<string | null> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId },
      select: { fallbackContentId: true },
    });
    return company?.fallbackContentId ?? null;
  }

  private toSyncItem(content: EntitledContent) {
    const isFile = this.isFileType(content.type);
    return {
      contentId: content.id,
      type: content.type,
      title: content.title,
      fileSizeBytes: content.fileSize != null ? content.fileSize.toString() : null,
      checksum: content.checksum,
      mimeType: content.mimeType,
      orientation: content.orientation,
      version: content.updatedAt.toISOString(),
      durationSeconds: content.durationSeconds,
      playFullVideo: false,
      pdfPageDurationSeconds: null,
      downloadPath: isFile && content.storageKey ? `/device/content/${content.id}/download` : null,
      url: content.type === ContentType.URL ? content.url : null,
      textBody: content.type === ContentType.TEXT ? content.textBody : null,
    };
  }

  private isFileType(type: ContentType): boolean {
    return type === ContentType.IMAGE || type === ContentType.VIDEO || type === ContentType.PDF;
  }

  private toConflict(s: {
    id: string;
    name: string;
    priority: number;
    scheduleType: 'NORMAL' | 'CAMPAIGN';
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
}
