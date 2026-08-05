import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Monitoring response shapes for the OpenAPI contract. See
 * `common/dto/api-response.dto.ts` for why these are classes and not the
 * interfaces the services already return.
 *
 * These live here rather than in `common/dto/entity-response.dto.ts` because
 * almost none of them describe a row. `MonitoringService` returns computed
 * aggregates — a status derived from the last heartbeat on every read, totals
 * counted in memory, alerts assembled from those totals — so there is no table
 * to check them against and no other module that returns the same shape.
 */

const LIVE_STATUS = [
  'ONLINE',
  'OFFLINE',
  'WARNING',
  'UNPAIRED',
  'PAIRING',
  'DISABLED',
  'ARCHIVED',
] as const;

/**
 * A screenshot as the LIST endpoint returns it.
 *
 * `ScreenshotService.list` strips `storageKey` and substitutes a short-lived
 * signed `url`. That is the same rule content follows: the object-storage path
 * is internal, and images are meant to be reached only through a URL that
 * expires. Publishing the key would hand a client the bucket layout.
 */
export class ScreenshotSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  takenAt!: string;

  @ApiProperty({ enum: ['AUTO', 'MANUAL'] })
  type!: string;

  @ApiPropertyOptional({ nullable: true })
  mimeType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  fileSizeBytes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Short-lived signed URL. null when signing failed; the caller re-reads rather than caching it.',
  })
  url?: string | null;
}

/**
 * The screenshot embedded in a per-screen monitoring read.
 *
 * Deliberately NOT `ScreenshotSummaryDto`. `ScreenshotService.latest` returns
 * four fields where `list` returns six — no `mimeType`, no `fileSizeBytes`.
 * Sharing one schema would tell a client the monitoring payload carries a size
 * it never loads, which is the same trap the playlist list/detail split avoids.
 */
export class LatestScreenshotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  takenAt!: string;

  @ApiProperty({ enum: ['AUTO', 'MANUAL'] })
  type!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Short-lived signed URL.' })
  url?: string | null;
}

/** Device-reported playback/network state, absent until a screen is paired. */
export class ScreenTelemetryDto {
  @ApiPropertyOptional({ nullable: true })
  playbackState?: string | null;

  @ApiPropertyOptional({ nullable: true })
  networkStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentPlaylistId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentScheduleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  manifestVersion?: number | null;

  @ApiPropertyOptional({ nullable: true })
  uptimeSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  appVersion?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Device `modelName`, renamed by the view.' })
  deviceModel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  osVersion?: string | null;

  @ApiPropertyOptional({ nullable: true })
  platform?: string | null;
}

/** Asset-sync and cache state for a paired screen. */
export class ScreenCacheDto {
  @ApiPropertyOptional({ nullable: true })
  syncStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  manifestSource?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  cacheSizeBytes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  availableStorageBytes?: string | null;

  @ApiProperty()
  requiredAssets!: number;

  @ApiProperty()
  cachedAssets!: number;

  @ApiProperty()
  failedDownloads!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Device `lastSyncError`, renamed by view.' })
  lastError?: string | null;
}

/**
 * What the device says it can do.
 *
 * Best-effort: read from the last heartbeat where present, otherwise defaulted.
 * Every field is therefore always present, even for a screen that has never
 * reported one — the defaults are what an older player is assumed to support.
 */
export class ScreenCapabilitiesDto {
  @ApiProperty({ description: 'Defaults to true when the device has not reported.' })
  screenshot!: boolean;

  @ApiProperty({ description: 'Defaults to false when the device has not reported.' })
  reboot!: boolean;

  @ApiProperty({ description: 'Defaults to false when the device has not reported.' })
  powerControl!: boolean;

  @ApiProperty({ description: 'Defaults to false when the device has not reported.' })
  kiosk!: boolean;

  @ApiProperty({ description: 'Defaults to false when the device has not reported.' })
  autoStart!: boolean;
}

/** GET /screens/{id}/monitoring. */
export class ScreenMonitoringDto {
  @ApiProperty()
  screenId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: LIVE_STATUS,
    description:
      'DERIVED on every read from the last heartbeat, not a stored column — a paired screen ' +
      'with no fresh heartbeat reads OFFLINE without any scheduler having written that.',
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Set only when status is WARNING.' })
  warningReason?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastHeartbeatAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  heartbeatIntervalSeconds?: number | null;

  @ApiProperty({ description: 'True only for a device row in ACTIVE status.' })
  paired!: boolean;

  @ApiPropertyOptional({ type: ScreenTelemetryDto, nullable: true })
  telemetry?: ScreenTelemetryDto | null;

  @ApiPropertyOptional({ type: ScreenCacheDto, nullable: true })
  cache?: ScreenCacheDto | null;

  @ApiPropertyOptional({ type: LatestScreenshotDto, nullable: true })
  latestScreenshot?: LatestScreenshotDto | null;

  @ApiProperty({ type: ScreenCapabilitiesDto })
  capabilities!: ScreenCapabilitiesDto;
}

/** One row of the fleet overview — a much shorter read than the per-screen one. */
export class FleetScreenDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  locationName?: string | null;

  @ApiProperty({ enum: LIVE_STATUS })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  warningReason?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastHeartbeatAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playbackState?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  syncStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  appVersion?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Serialised as a string (64-bit column).' })
  cacheSizeBytes?: string | null;

  @ApiProperty()
  failedDownloads!: number;

  @ApiProperty()
  paired!: boolean;
}

/** Fleet counts, one per live status. */
export class FleetTotalsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  online!: number;

  @ApiProperty()
  offline!: number;

  @ApiProperty()
  warning!: number;

  @ApiProperty()
  unpaired!: number;

  @ApiProperty()
  pairing!: number;

  @ApiProperty()
  disabled!: number;

  @ApiProperty()
  archived!: number;
}

/** An offline or warning screen, surfaced for the dashboard's alert list. */
export class FleetAlertDto {
  @ApiProperty({ enum: ['WARNING', 'CRITICAL'] })
  severity!: string;

  @ApiProperty()
  screenId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  message!: string;
}

/** GET /monitoring/overview. */
export class MonitoringOverviewDto {
  @ApiProperty({ type: FleetTotalsDto })
  totals!: FleetTotalsDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Screen count per sync status. The keys are whatever the fleet is currently reporting, ' +
      "plus 'NONE' for screens with no device row — so it is an open map, not a fixed set.",
    example: { SYNCED: 12, SYNCING: 1, NONE: 3 },
  })
  syncBreakdown!: Record<string, number>;

  @ApiProperty()
  withFailedDownloads!: number;

  @ApiProperty({ description: 'Paired screens whose derived status is OFFLINE.' })
  missingHeartbeat!: number;

  @ApiProperty({ type: [FleetAlertDto] })
  alerts!: FleetAlertDto[];

  @ApiProperty({ type: [FleetScreenDto] })
  screens!: FleetScreenDto[];
}

/**
 * A remote command as the dashboard sees it.
 *
 * `DeviceCommandService.toView` is an allow-list: it returns neither
 * `companyId` nor `deviceId`. The company is already implied by the caller's
 * token, and the device id is an internal join key — declaring either would
 * have the contract promise a field the API does not send.
 */
export class DeviceCommandDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  screenId!: string;

  @ApiProperty({
    enum: [
      'FORCE_SYNC',
      'REFRESH_MANIFEST',
      'RESTART_PLAYBACK',
      'CLEAR_CACHE',
      'TAKE_SCREENSHOT',
      'REBOOT_DEVICE',
      'UNPAIR_DEVICE',
      'RELOAD_CONFIG',
    ],
  })
  commandType!: string;

  @ApiProperty({
    enum: ['PENDING', 'DELIVERED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  })
  status!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Command-specific arguments; `{}` for the parameterless actions.',
  })
  payload?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Whatever the device reported back; null until it completes.',
  })
  result?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  error?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null for a system-issued command.' })
  issuedById?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  deliveredAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  startedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  completedAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'A command not collected by this time is marked EXPIRED on the next poll.',
  })
  expiresAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
