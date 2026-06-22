import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CompanyStatus,
  ContentStatus,
  ContentType,
  EmergencyBroadcastStatus,
  EmergencyBroadcastType,
  Orientation,
  Prisma,
  ScheduleStatus,
} from '@prisma/client';

import { OutsideHoursBehavior } from '../../common/dto/working-hours.dto';
import { orientationProfile, orientationWarning } from '../../common/scheduling/orientation.util';
import { localMoment } from '../../common/scheduling/schedule-time.util';
import {
  evaluateWorkingHours,
  type WorkingHoursConfig,
} from '../../common/scheduling/working-hours.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DEFAULT_ITEM_DURATION_SECONDS } from '../playlists/playlists.service';
import {
  compareSchedulePrecedence,
  type ConflictSchedule,
  screenMatchesTargets,
  scheduleActiveAt,
} from './schedule-targeting';

/** Signed URLs in the manifest are valid for this long (see handoff notes). */
const MANIFEST_SIGNED_TTL_SECONDS = 3600;

export interface ManifestItem {
  contentId: string;
  type: ContentType;
  title: string;
  durationSeconds: number;
  playFullVideo: boolean;
  pdfPageDurationSeconds: number | null;
  orientation: Orientation;
  fileSizeBytes: string | null;
  checksum: string | null;
  mimeType: string | null;
  /** Short-lived signed URL for online playback of stored files; null otherwise. */
  signedUrl: string | null;
  /**
   * Device-authenticated download path for offline caching (Phase 7), relative
   * to /api — e.g. `/device/content/{id}/download`. null for URL/TEXT.
   */
  downloadPath: string | null;
  /** Content version marker (updatedAt ISO) so the cache can detect changes. */
  version: string;
  /** External URL for URL content; null otherwise. */
  url: string | null;
  /** Body for TEXT content; null otherwise. */
  textBody: string | null;
  metadata: Record<string, unknown>;
}

export type ManifestSourceType = 'SCHEDULE' | 'FALLBACK' | 'EMERGENCY' | 'NONE';

export interface ScreenPlaybackManifest {
  screenId: string;
  generatedAt: string;
  timezone: string;
  sourceType: ManifestSourceType;
  scheduleId: string | null;
  scheduleName: string | null;
  playlistId: string | null;
  playlistTitle: string | null;
  /** Set when sourceType = EMERGENCY (Phase 9). null otherwise. */
  emergencyBroadcastId: string | null;
  priority: number | null;
  outsideHours: boolean;
  outsideHoursBehavior: OutsideHoursBehavior | null;
  message: string | null;
  items: ManifestItem[];
  warnings: string[];
}

/** Synthetic content-id prefix for direct TEXT/URL emergency items (no library
 * Content backs them). The player keys on it but reports proof-of-play with a
 * null contentId — there is no Content FK to satisfy. */
export const EMERGENCY_SYNTHETIC_PREFIX = 'emg:';

const CONTENT_FIELDS = {
  id: true,
  type: true,
  title: true,
  orientation: true,
  status: true,
  expiresAt: true,
  deletedAt: true,
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

type ContentRow = Prisma.ContentGetPayload<{ select: typeof CONTENT_FIELDS }>;

/**
 * Resolves what a screen should play at a given instant and returns a playback
 * manifest for the future Android player (Phase 6/7). Honors: company/screen
 * status, working hours + outside-hours behavior, schedule date/day/time
 * targeting, priority/conflict rules, content validity, and the screen →
 * location → company fallback hierarchy. Read-only; produces no side effects.
 */
@Injectable()
export class ScheduleResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async resolve(
    companyId: string,
    screenId: string,
    at: Date = new Date(),
  ): Promise<ScreenPlaybackManifest> {
    const screen = await this.prisma.screen.findFirst({
      where: { id: screenId, companyId, deletedAt: null },
      include: {
        location: { select: { timezone: true, workingHours: true, fallbackContentId: true } },
        groups: { select: { groupId: true } },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const company = await this.prisma.company.findFirst({
      where: { id: companyId },
      select: { timezone: true, settings: true, fallbackContentId: true, status: true },
    });

    const companySettings = (company?.settings ?? {}) as Record<string, unknown>;
    const companyWorkingHours = (companySettings.defaultWorkingHours ??
      null) as WorkingHoursConfig | null;
    const screenWh = screen.workingHours as WorkingHoursConfig | null;
    const locationWh = (screen.location?.workingHours ?? null) as WorkingHoursConfig | null;

    const timezone = screenWh?.timezone || screen.location?.timezone || company?.timezone || 'UTC';

    const base: ScreenPlaybackManifest = {
      screenId,
      generatedAt: at.toISOString(),
      timezone,
      sourceType: 'NONE',
      scheduleId: null,
      scheduleName: null,
      playlistId: null,
      playlistTitle: null,
      emergencyBroadcastId: null,
      priority: null,
      outsideHours: false,
      outsideHoursBehavior: null,
      message: null,
      items: [],
      warnings: [],
    };

    // Company / screen availability gates.
    if (company && company.status !== CompanyStatus.ACTIVE) {
      return {
        ...base,
        warnings: [`Company is ${company.status.toLowerCase()}; nothing is served.`],
      };
    }
    if (screen.status === 'ARCHIVED' || screen.status === 'DISABLED') {
      return {
        ...base,
        warnings: [`Screen is ${screen.status.toLowerCase()}; nothing is served.`],
      };
    }

    // Index this screen for target matching (used by emergencies + schedules).
    const groupIds = screen.groups.map((g) => g.groupId);
    const indexedScreen = {
      id: screen.id,
      locationId: screen.locationId,
      orientation: screen.orientation,
      groupIds,
    };

    // EMERGENCY first — an active emergency broadcast pre-empts everything,
    // including working hours (Phase 9). Highest priority wins; newest breaks ties.
    const emergency = await this.resolveEmergency(companyId, screen, indexedScreen, base, at);
    if (emergency) return emergency;

    // Working hours.
    const effectiveWh = screenWh ?? locationWh ?? companyWorkingHours;
    const whEval = evaluateWorkingHours(effectiveWh, at, timezone);
    if (!whEval.withinHours) {
      base.outsideHours = true;
      base.outsideHoursBehavior = whEval.behavior;
      if (whEval.behavior === OutsideHoursBehavior.FALLBACK) {
        return this.withFallback(companyId, screen, company?.fallbackContentId ?? null, base, [
          'Outside working hours — showing fallback content.',
        ]);
      }
      base.message =
        whEval.behavior === OutsideHoursBehavior.CUSTOM_MESSAGE ? whEval.message : null;
      base.warnings.push(`Outside working hours — behavior: ${whEval.behavior}.`);
      return base;
    }

    // Candidate schedules targeting this screen, active at `at`.
    const schedules = await this.prisma.schedule.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: ScheduleStatus.ACTIVE,
        playlistId: { not: null },
      },
      include: {
        targets: true,
        playlist: { select: { id: true, title: true, status: true, deletedAt: true } },
      },
      take: 500,
    });

    const matching = schedules.filter((s) => {
      // Only ACTIVE (published) playlists play — never DRAFT/ARCHIVED/soft-deleted.
      if (!s.playlist || s.playlist.deletedAt || s.playlist.status !== 'ACTIVE') return false;
      if (!screenMatchesTargets(indexedScreen, s.targets)) return false;
      const tz = s.timezone || timezone;
      const moment = localMoment(at, tz);
      return scheduleActiveAt(this.toConflict(s), moment.ymd, moment.weekday, moment.hhmm);
    });
    matching.sort((a, b) => compareSchedulePrecedence(this.toConflict(a), this.toConflict(b)));

    // First matching schedule whose playlist yields at least one valid item wins.
    for (const schedule of matching) {
      if (!schedule.playlistId) continue;
      const { items, warnings } = await this.buildPlaylistItems(schedule.playlistId);
      if (items.length > 0) {
        const orientationWarnings = this.orientationWarningsForItems(items, screen.orientation);
        return {
          ...base,
          sourceType: 'SCHEDULE',
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          playlistId: schedule.playlistId,
          playlistTitle: schedule.playlist?.title ?? null,
          priority: schedule.priority,
          items,
          warnings: [...warnings, ...orientationWarnings],
        };
      }
    }

    // No usable schedule → fallback hierarchy.
    return this.withFallback(
      companyId,
      screen,
      company?.fallbackContentId ?? null,
      base,
      matching.length > 0 ? ['Matched schedules had no playable content — using fallback.'] : [],
    );
  }

  // --- Emergency (Phase 9) -----------------------------------------------

  /**
   * The highest-priority ACTIVE emergency broadcast targeting this screen, built
   * into an EMERGENCY manifest. Emergencies override schedules AND working hours.
   * Returns null when none apply (caller falls through to the normal logic).
   *
   * "Live" = status ACTIVE and within [startAt, endAt] (open-ended if null) at
   * `at`. Ties break by priority desc, then newest updatedAt. The first live
   * broadcast that yields ≥1 playable item wins; broken content is skipped.
   */
  private async resolveEmergency(
    companyId: string,
    screen: { orientation: Orientation },
    indexedScreen: {
      id: string;
      locationId: string | null;
      orientation: Orientation;
      groupIds: string[];
    },
    base: ScreenPlaybackManifest,
    at: Date,
  ): Promise<ScreenPlaybackManifest | null> {
    const broadcasts = await this.prisma.emergencyBroadcast.findMany({
      where: { companyId, status: EmergencyBroadcastStatus.ACTIVE },
      include: { targets: true },
      take: 100,
    });

    const live = broadcasts
      .filter(
        (b) =>
          (b.startAt == null || b.startAt.getTime() <= at.getTime()) &&
          (b.endAt == null || b.endAt.getTime() >= at.getTime()),
      )
      .filter((b) => screenMatchesTargets(indexedScreen, b.targets))
      .sort((a, b) =>
        a.priority !== b.priority
          ? b.priority - a.priority
          : b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

    for (const broadcast of live) {
      const { items, warnings } = await this.buildEmergencyItems(companyId, broadcast);
      if (items.length === 0) continue;
      const orientationWarnings = this.orientationWarningsForItems(items, screen.orientation);
      return {
        ...base,
        sourceType: 'EMERGENCY',
        emergencyBroadcastId: broadcast.id,
        priority: broadcast.priority,
        message: broadcast.broadcastType === EmergencyBroadcastType.TEXT ? broadcast.message : null,
        items,
        warnings: [...base.warnings, ...warnings, ...orientationWarnings],
      };
    }
    return null;
  }

  private async buildEmergencyItems(
    companyId: string,
    broadcast: {
      id: string;
      broadcastType: EmergencyBroadcastType;
      contentId: string | null;
      playlistId: string | null;
      message: string | null;
      url: string | null;
      updatedAt: Date;
    },
  ): Promise<{ items: ManifestItem[]; warnings: string[] }> {
    switch (broadcast.broadcastType) {
      case EmergencyBroadcastType.CONTENT: {
        if (!broadcast.contentId) return { items: [], warnings: ['Emergency content is missing.'] };
        const content = await this.prisma.content.findFirst({
          where: { id: broadcast.contentId, companyId, deletedAt: null },
          select: CONTENT_FIELDS,
        });
        if (!content || !this.isPlayable(content)) {
          return {
            items: [],
            warnings: ['Emergency content is not playable (expired/archived/missing).'],
          };
        }
        const item = await this.toManifestItem(content, {
          durationSeconds: null,
          playFullVideo: false,
          pdfPageDurationSeconds: null,
        });
        return { items: [item], warnings: [] };
      }
      case EmergencyBroadcastType.PLAYLIST: {
        if (!broadcast.playlistId)
          return { items: [], warnings: ['Emergency playlist is missing.'] };
        return this.buildPlaylistItems(broadcast.playlistId);
      }
      case EmergencyBroadcastType.TEXT:
        if (!broadcast.message?.trim())
          return { items: [], warnings: ['Emergency text is empty.'] };
        return {
          items: [this.syntheticItem(broadcast, ContentType.TEXT, { textBody: broadcast.message })],
          warnings: [],
        };
      case EmergencyBroadcastType.URL:
        if (!broadcast.url?.trim()) return { items: [], warnings: ['Emergency URL is empty.'] };
        return {
          items: [this.syntheticItem(broadcast, ContentType.URL, { url: broadcast.url })],
          warnings: [],
        };
      default:
        return { items: [], warnings: [] };
    }
  }

  /** Synthetic manifest item for a direct TEXT/URL emergency (no library Content). */
  private syntheticItem(
    broadcast: { id: string; updatedAt: Date },
    type: ContentType,
    body: { textBody?: string | null; url?: string | null },
  ): ManifestItem {
    return {
      contentId: `${EMERGENCY_SYNTHETIC_PREFIX}${broadcast.id}`,
      type,
      title: 'Emergency',
      durationSeconds: DEFAULT_ITEM_DURATION_SECONDS,
      playFullVideo: false,
      pdfPageDurationSeconds: null,
      orientation: Orientation.UNKNOWN,
      fileSizeBytes: null,
      checksum: null,
      mimeType: null,
      signedUrl: null,
      downloadPath: null,
      version: broadcast.updatedAt.toISOString(),
      url: body.url ?? null,
      textBody: body.textBody ?? null,
      metadata: { emergency: true },
    };
  }

  // --- Fallback ----------------------------------------------------------

  private async withFallback(
    companyId: string,
    screen: {
      orientation: Orientation;
      fallbackContentId: string | null;
      location: { fallbackContentId: string | null } | null;
    },
    companyFallbackId: string | null,
    base: ScreenPlaybackManifest,
    extraWarnings: string[],
  ): Promise<ScreenPlaybackManifest> {
    const fallbackId =
      screen.fallbackContentId ?? screen.location?.fallbackContentId ?? companyFallbackId ?? null;
    const warnings = [...base.warnings, ...extraWarnings];
    if (!fallbackId) {
      return {
        ...base,
        sourceType: 'NONE',
        warnings: [...warnings, 'No fallback content configured.'],
      };
    }
    const content = await this.prisma.content.findFirst({
      where: { id: fallbackId, companyId, deletedAt: null },
      select: CONTENT_FIELDS,
    });
    if (!content || !this.isPlayable(content)) {
      return {
        ...base,
        sourceType: 'NONE',
        warnings: [...warnings, 'Fallback content is not playable (expired/archived/missing).'],
      };
    }
    const item = await this.toManifestItem(content, {
      durationSeconds: null,
      playFullVideo: false,
      pdfPageDurationSeconds: null,
    });
    const orientationWarnings = this.orientationWarningsForItems([item], screen.orientation);
    return {
      ...base,
      sourceType: 'FALLBACK',
      items: [item],
      warnings: [...warnings, ...orientationWarnings],
    };
  }

  // --- Item building -----------------------------------------------------

  private async buildPlaylistItems(
    playlistId: string,
  ): Promise<{ items: ManifestItem[]; warnings: string[] }> {
    const rows = await this.prisma.playlistItem.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
      include: { content: { select: CONTENT_FIELDS } },
    });
    const items: ManifestItem[] = [];
    const warnings: string[] = [];
    for (const row of rows) {
      if (!this.isPlayable(row.content)) {
        warnings.push(
          `Skipped "${row.content?.title ?? row.contentId}" (expired/archived/trashed/deleted).`,
        );
        continue;
      }
      items.push(
        await this.toManifestItem(row.content, {
          durationSeconds: row.durationSeconds,
          playFullVideo: row.playFullVideo,
          pdfPageDurationSeconds: row.pdfPageDurationSeconds,
        }),
      );
    }
    return { items, warnings };
  }

  private isPlayable(content: ContentRow | null): boolean {
    if (!content) return false;
    if (content.deletedAt || content.status !== ContentStatus.ACTIVE) return false;
    if (content.expiresAt && content.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  private async toManifestItem(
    content: ContentRow,
    item: {
      durationSeconds: number | null;
      playFullVideo: boolean;
      pdfPageDurationSeconds: number | null;
    },
  ): Promise<ManifestItem> {
    const isFile =
      content.type === ContentType.IMAGE ||
      content.type === ContentType.VIDEO ||
      content.type === ContentType.PDF;
    let signedUrl: string | null = null;
    if (isFile && content.storageKey) {
      signedUrl = await this.storage
        .getSignedUrl(
          content.storageKey,
          content.mimeType ?? 'application/octet-stream',
          MANIFEST_SIGNED_TTL_SECONDS,
        )
        .catch(() => null);
    }
    const duration =
      content.type === ContentType.VIDEO && item.playFullVideo
        ? // Full-length playback: ignore the per-item duration; 0 ⇒ play to natural end.
          (content.durationSeconds ?? 0)
        : (item.durationSeconds ?? content.durationSeconds ?? DEFAULT_ITEM_DURATION_SECONDS);

    return {
      contentId: content.id,
      type: content.type,
      title: content.title,
      durationSeconds: duration,
      playFullVideo: content.type === ContentType.VIDEO ? item.playFullVideo : false,
      pdfPageDurationSeconds: content.type === ContentType.PDF ? item.pdfPageDurationSeconds : null,
      orientation: content.orientation,
      fileSizeBytes: content.fileSize != null ? content.fileSize.toString() : null,
      checksum: content.checksum,
      mimeType: content.mimeType,
      signedUrl,
      // Prefer the device download endpoint for offline caching (Phase 7); the
      // device authenticates with its token and the bytes are streamed server-side.
      downloadPath: isFile && content.storageKey ? `/device/content/${content.id}/download` : null,
      version: content.updatedAt.toISOString(),
      url: content.type === ContentType.URL ? content.url : null,
      textBody: content.type === ContentType.TEXT ? content.textBody : null,
      metadata: { pageCount: content.pageCount ?? null },
    };
  }

  private orientationWarningsForItems(
    items: ManifestItem[],
    screenOrientation: Orientation,
  ): string[] {
    const profile = orientationProfile(items.map((i) => i.orientation));
    const warning = orientationWarning(profile, screenOrientation, 'Content');
    return warning ? [warning] : [];
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
