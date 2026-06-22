import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProofOfPlayStatus } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ProofOfPlayEventDto,
  ProofOfPlayQueryDto,
  ReportProofOfPlayDto,
} from './dto/proof-of-play.dto';
import {
  BACKFILL_WINDOW_MS,
  EVENT_STATUS,
  EXPORT_ROW_CAP,
  FUTURE_SKEW_MS,
} from './proof-of-play.constants';

const TERMINAL_STATUSES: ProofOfPlayStatus[] = [
  ProofOfPlayStatus.COMPLETED,
  ProofOfPlayStatus.FAILED,
  ProofOfPlayStatus.SKIPPED,
  ProofOfPlayStatus.INTERRUPTED,
];

/**
 * Proof-of-Play (Phase 9). Ingests REAL player playback events from devices
 * (idempotent, token-scoped) and serves company-scoped reports/exports for the
 * dashboard. Deliberately independent of heartbeat, sync status, and manifest
 * generation — those are never treated as proof of play.
 */
@Injectable()
export class ProofOfPlayService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Device ingest -----------------------------------------------------

  /**
   * Accept a batch of playback events for the device's OWN screen. Tenancy is
   * derived from the token; the payload's company/screen are ignored entirely.
   * Returns counts — it never throws on individual bad events (playback must
   * not be affected by reporting), only on a structurally invalid batch.
   */
  async ingest(
    device: AuthenticatedDevice,
    dto: ReportProofOfPlayDto,
  ): Promise<{ accepted: number; rejected: number }> {
    // No deletedAt filter: a device may flush buffered events for a screen that
    // was archived/soft-deleted after the fact — those audit records must still
    // land (the screenId FK only needs the row to exist).
    const screen = await this.prisma.screen.findFirst({
      where: { id: device.screenId, companyId: device.companyId },
      select: { id: true, locationId: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');

    const now = Date.now();
    let accepted = 0;
    let rejected = 0;

    for (const event of dto.events) {
      const startedAt = new Date(event.startedAt);
      const startMs = startedAt.getTime();
      // Drop events with an unusable timestamp: too far in the future (clock
      // skew) or older than the offline back-fill window.
      if (
        Number.isNaN(startMs) ||
        startMs > now + FUTURE_SKEW_MS ||
        startMs < now - BACKFILL_WINDOW_MS
      ) {
        rejected++;
        continue;
      }
      try {
        await this.upsertEvent(device, screen.locationId, event, startedAt);
        accepted++;
      } catch {
        // A single malformed event never fails the batch.
        rejected++;
      }
    }
    return { accepted, rejected };
  }

  /**
   * Idempotent upsert keyed on `playbackSessionId`. ITEM_STARTED opens the row;
   * a terminal event closes it. A terminal status is never regressed back to
   * STARTED, and the first terminal state wins (devices send one terminal event
   * per session) — so re-sent / out-of-order events converge to the same row.
   */
  private async upsertEvent(
    device: AuthenticatedDevice,
    locationId: string | null,
    event: ProofOfPlayEventDto,
    startedAt: Date,
  ): Promise<void> {
    const status = EVENT_STATUS[event.eventType] as ProofOfPlayStatus;
    const endedAt = event.endedAt ? new Date(event.endedAt) : null;

    const existing = await this.prisma.proofOfPlay.findUnique({
      where: { playbackSessionId: event.playbackSessionId },
      select: { id: true, status: true },
    });

    if (!existing) {
      try {
        await this.prisma.proofOfPlay.create({
          data: {
            companyId: device.companyId,
            screenId: device.screenId,
            deviceId: device.id,
            locationId,
            contentId: event.contentId ?? null,
            playlistId: event.playlistId ?? null,
            playlistItemId: event.playlistItemId ?? null,
            scheduleId: event.scheduleId ?? null,
            emergencyBroadcastId: event.emergencyBroadcastId ?? null,
            sourceType: event.sourceType ?? 'NONE',
            playbackSource: event.playbackSource ?? 'UNKNOWN',
            contentType: event.contentType ?? null,
            startedAt,
            endedAt,
            durationMs: event.durationMs ?? null,
            expectedDurationMs: event.expectedDurationMs ?? null,
            status,
            failureReason: event.failureReason ?? null,
            manifestVersion: event.manifestVersion ?? null,
            playbackSessionId: event.playbackSessionId,
            itemSequence: event.itemSequence ?? null,
            offlinePlayback: event.offlinePlayback ?? false,
            metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
          },
        });
        return;
      } catch (e) {
        // Lost a create race against a concurrent batch — fall through to update.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      }
    }

    // Row exists (or we just lost the create race): apply terminal transition only.
    const existingTerminal = existing ? TERMINAL_STATUSES.includes(existing.status) : false;
    const incomingTerminal = status !== ProofOfPlayStatus.STARTED;
    if (!incomingTerminal || existingTerminal) return; // STARTED-on-existing or already-terminal: idempotent no-op.

    await this.prisma.proofOfPlay.update({
      where: { playbackSessionId: event.playbackSessionId },
      data: {
        status,
        endedAt,
        durationMs: event.durationMs ?? undefined,
        failureReason: event.failureReason ?? undefined,
        // Late context that may only be known at completion.
        emergencyBroadcastId: event.emergencyBroadcastId ?? undefined,
        scheduleId: event.scheduleId ?? undefined,
      },
    });
  }

  // --- Dashboard reports -------------------------------------------------

  async report(companyId: string, query: ProofOfPlayQueryDto) {
    const where = this.buildWhere(companyId, query);
    const { skip, take, meta } = resolvePagination(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.proofOfPlay.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take,
        include: {
          screen: { select: { name: true, location: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.proofOfPlay.count({ where }),
    ]);

    const labels = await this.resolveLabels(companyId, rows);
    return { items: rows.map((r) => this.toView(r, labels)), meta: meta(total) };
  }

  async summary(companyId: string, query: ProofOfPlayQueryDto) {
    const where = this.buildWhere(companyId, query);
    const [byStatus, durationAgg, topContentRaw, failingScreensRaw] = await Promise.all([
      this.prisma.proofOfPlay.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.proofOfPlay.aggregate({ where, _sum: { durationMs: true } }),
      this.prisma.proofOfPlay.groupBy({
        by: ['contentId'],
        where: { ...where, contentId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { contentId: 'desc' } },
        take: 5,
      }),
      this.prisma.proofOfPlay.groupBy({
        by: ['screenId'],
        where: { ...where, status: ProofOfPlayStatus.FAILED },
        _count: { _all: true },
        orderBy: { _count: { screenId: 'desc' } },
        take: 10,
      }),
    ]);

    const counts: Record<string, number> = {
      STARTED: 0,
      COMPLETED: 0,
      FAILED: 0,
      SKIPPED: 0,
      INTERRUPTED: 0,
    };
    let total = 0;
    for (const row of byStatus) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }

    const contentIds = topContentRaw.map((r) => r.contentId).filter((id): id is string => !!id);
    const screenIds = failingScreensRaw.map((r) => r.screenId);
    const [contents, screens] = await Promise.all([
      this.prisma.content.findMany({
        where: { id: { in: contentIds }, companyId },
        select: { id: true, title: true },
      }),
      this.prisma.screen.findMany({
        where: { id: { in: screenIds }, companyId },
        select: { id: true, name: true },
      }),
    ]);
    const contentTitle = new Map(contents.map((c) => [c.id, c.title]));
    const screenName = new Map(screens.map((s) => [s.id, s.name]));

    return {
      totalPlays: total,
      completedPlays: counts.COMPLETED,
      failedPlays: counts.FAILED,
      skippedPlays: counts.SKIPPED,
      interruptedPlays: counts.INTERRUPTED,
      startedPlays: counts.STARTED,
      totalDurationMs: durationAgg._sum.durationMs ?? 0,
      mostPlayedContent: topContentRaw.map((r) => ({
        contentId: r.contentId,
        title: r.contentId ? (contentTitle.get(r.contentId) ?? null) : null,
        plays: r._count._all,
      })),
      screensWithFailures: failingScreensRaw.map((r) => ({
        screenId: r.screenId,
        name: screenName.get(r.screenId) ?? null,
        failures: r._count._all,
      })),
    };
  }

  /** CSV export (capped). Returns the raw CSV string; the controller sets headers. */
  async exportCsv(companyId: string, query: ProofOfPlayQueryDto): Promise<string> {
    const where = this.buildWhere(companyId, query);
    const rows = await this.prisma.proofOfPlay.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: EXPORT_ROW_CAP,
      include: {
        screen: { select: { name: true, location: { select: { id: true, name: true } } } },
      },
    });
    const labels = await this.resolveLabels(companyId, rows);

    const header = [
      'startedAt',
      'endedAt',
      'screen',
      'location',
      'content',
      'contentType',
      'playlist',
      'schedule',
      'emergencyBroadcast',
      'sourceType',
      'playbackSource',
      'status',
      'durationMs',
      'expectedDurationMs',
      'offline',
      'failureReason',
      'manifestVersion',
      'playbackSessionId',
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const v = this.toView(r, labels);
      lines.push(
        [
          v.startedAt,
          v.endedAt ?? '',
          v.screenName ?? '',
          v.locationName ?? '',
          v.contentTitle ?? '',
          v.contentType ?? '',
          v.playlistTitle ?? '',
          v.scheduleName ?? '',
          v.emergencyBroadcastTitle ?? '',
          v.sourceType,
          v.playbackSource,
          v.status,
          v.durationMs ?? '',
          v.expectedDurationMs ?? '',
          v.offlinePlayback ? 'true' : 'false',
          v.failureReason ?? '',
          v.manifestVersion ?? '',
          v.playbackSessionId,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }

  // --- Helpers -----------------------------------------------------------

  private buildWhere(companyId: string, query: ProofOfPlayQueryDto): Prisma.ProofOfPlayWhereInput {
    const where: Prisma.ProofOfPlayWhereInput = { companyId };
    if (query.screenId) where.screenId = query.screenId;
    if (query.locationId) where.locationId = query.locationId;
    if (query.contentId) where.contentId = query.contentId;
    if (query.playlistId) where.playlistId = query.playlistId;
    if (query.scheduleId) where.scheduleId = query.scheduleId;
    if (query.emergencyBroadcastId) where.emergencyBroadcastId = query.emergencyBroadcastId;
    if (query.status) where.status = query.status;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.playbackSource) where.playbackSource = query.playbackSource;
    if (query.offlineOnly) where.offlinePlayback = true;
    if (query.from || query.to) {
      where.startedAt = {};
      if (query.from) where.startedAt.gte = new Date(query.from);
      if (query.to) where.startedAt.lte = new Date(query.to);
    }
    return where;
  }

  /** Batch-resolve soft-reference labels (content/playlist/schedule/emergency) for a page. */
  private async resolveLabels(
    companyId: string,
    rows: Array<{
      contentId: string | null;
      playlistId: string | null;
      scheduleId: string | null;
      emergencyBroadcastId: string | null;
    }>,
  ) {
    const contentIds = unique(rows.map((r) => r.contentId));
    const playlistIds = unique(rows.map((r) => r.playlistId));
    const scheduleIds = unique(rows.map((r) => r.scheduleId));
    const broadcastIds = unique(rows.map((r) => r.emergencyBroadcastId));
    const [contents, playlists, schedules, broadcasts] = await this.prisma.$transaction([
      this.prisma.content.findMany({
        where: { id: { in: contentIds }, companyId },
        select: { id: true, title: true },
      }),
      this.prisma.playlist.findMany({
        where: { id: { in: playlistIds }, companyId },
        select: { id: true, title: true },
      }),
      this.prisma.schedule.findMany({
        where: { id: { in: scheduleIds }, companyId },
        select: { id: true, name: true },
      }),
      this.prisma.emergencyBroadcast.findMany({
        where: { id: { in: broadcastIds }, companyId },
        select: { id: true, title: true },
      }),
    ]);
    return {
      content: new Map(contents.map((c) => [c.id, c.title])),
      playlist: new Map(playlists.map((p) => [p.id, p.title])),
      schedule: new Map(schedules.map((s) => [s.id, s.name])),
      broadcast: new Map(broadcasts.map((b) => [b.id, b.title])),
    };
  }

  private toView(
    r: Prisma.ProofOfPlayGetPayload<{
      include: {
        screen: { select: { name: true; location: { select: { id: true; name: true } } } };
      };
    }>,
    labels: {
      content: Map<string, string>;
      playlist: Map<string, string>;
      schedule: Map<string, string>;
      broadcast: Map<string, string>;
    },
  ) {
    return {
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      screenId: r.screenId,
      screenName: r.screen?.name ?? null,
      locationId: r.locationId,
      locationName: r.screen?.location?.name ?? null,
      contentId: r.contentId,
      contentTitle: r.contentId ? (labels.content.get(r.contentId) ?? null) : null,
      contentType: r.contentType,
      playlistId: r.playlistId,
      playlistTitle: r.playlistId ? (labels.playlist.get(r.playlistId) ?? null) : null,
      scheduleId: r.scheduleId,
      scheduleName: r.scheduleId ? (labels.schedule.get(r.scheduleId) ?? null) : null,
      emergencyBroadcastId: r.emergencyBroadcastId,
      emergencyBroadcastTitle: r.emergencyBroadcastId
        ? (labels.broadcast.get(r.emergencyBroadcastId) ?? null)
        : null,
      sourceType: r.sourceType,
      playbackSource: r.playbackSource,
      status: r.status,
      durationMs: r.durationMs,
      expectedDurationMs: r.expectedDurationMs,
      offlinePlayback: r.offlinePlayback,
      failureReason: r.failureReason,
      manifestVersion: r.manifestVersion,
      itemSequence: r.itemSequence,
      playbackSessionId: r.playbackSessionId,
    };
  }
}

function unique(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** RFC-4180 CSV escaping; prefix risky leading chars to defuse formula injection. */
function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
