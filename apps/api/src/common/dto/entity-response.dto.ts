import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Entity response shapes for the OpenAPI contract.
 *
 * Same rule as `api-response.dto.ts`: these must be CLASSES, because
 * `@nestjs/swagger` reflects decorator metadata and a TypeScript interface is
 * erased at compile time. They are declaration-only — the services' return types
 * remain the source of truth for the code; these describe that truth to clients.
 *
 * A field listed here is a field the contract PROMISES the API returns. Adding
 * one is a published commitment, and — as `Screen.kioskPinHash` shows — leaving
 * one out can be the whole point.
 */

class TenantOwnedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Owning tenant. Derived from the caller's token, never the body." })
  companyId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TagDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: '#2F80ED' })
  color?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({
    enum: ['CONTENT', 'SCREEN', 'BOTH'],
    description: 'Which resources the tag may be applied to.',
  })
  type?: string;
}

export class ScreenGroupDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  category?: string | null;

  @ApiPropertyOptional({ description: 'Members, when the endpoint includes them.' })
  screenCount?: number;
}

export class LocationDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Tenant-unique short code.' })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  region?: string | null;

  @ApiPropertyOptional({ nullable: true })
  country?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  longitude?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Asia/Riyadh',
    description:
      'IANA zone. Schedules resolve against it, so a bare city name runs them hours off.',
  })
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opening hours per weekday; screens outside them follow the outside-hours policy.',
  })
  workingHours?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  fallbackContentId?: string | null;

  @ApiPropertyOptional({ description: 'Screens at this location, when the endpoint includes it.' })
  screenCount?: number;
}

/** A tag or group as it appears nested inside another resource. */
export class NestedRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * A screen as the API returns it.
 *
 * Written from `ScreensService.toView`, NOT from the Prisma model — the two
 * differ in exactly the way that matters. The model carries `kioskPinHash`;
 * the view strips it and substitutes `hasKioskPin`. A DTO generated from the
 * schema would publish a password-hash field as a documented part of the API,
 * and the name sits close enough to the other 32 to survive a skim.
 */
export class ScreenDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationId?: string | null;

  @ApiPropertyOptional({ type: NestedRefDto, nullable: true })
  location?: NestedRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Hardware id reported by the paired player; null until pairing.',
  })
  deviceIdentifier?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pairedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastHeartbeatAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  appVersion?: string | null;

  @ApiProperty()
  audioEnabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  volume!: number;

  @ApiProperty()
  muted!: boolean;

  @ApiPropertyOptional({ nullable: true })
  muteSchedule?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  workingHours?: Record<string, unknown> | null;

  @ApiProperty()
  kioskEnabled!: boolean;

  @ApiProperty({
    description:
      'Whether an exit PIN is set. The PIN itself is stored hashed and is never returned — ' +
      'this boolean replaces it.',
  })
  hasKioskPin!: boolean;

  @ApiProperty()
  autoStartEnabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  powerControlMode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fallbackContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentPlaylistId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Bytes, as a STRING. The column is a 64-bit integer and would lose precision as a JSON ' +
      'number, so PrismaService serialises BigInt via toJSON.',
  })
  storageUsedBytes?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Bytes, as a string.' })
  storageTotalBytes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  capabilities?: Record<string, unknown> | null;

  @ApiProperty()
  heartbeatIntervalSeconds!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  longitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiProperty({ type: [TagDto] })
  tags!: TagDto[];

  @ApiProperty({ type: [NestedRefDto] })
  groups!: NestedRefDto[];
}

/**
 * A content item as the API returns it.
 *
 * From `ContentService.toView`, not the Prisma model. The view strips three
 * fields, and each omission is deliberate:
 *
 *   storageKey — the object-storage path. Publishing it hands a client the
 *                internal layout of the bucket; files are reached through a
 *                short-lived signed URL from the preview endpoint instead.
 *   checksum   — an integrity value for the player's cache, not part of the
 *                dashboard contract.
 *   meta       — untyped internal JSON with no stable shape to document.
 *
 * It adds `isExpired`, which is derived at read time and exists in no column.
 */
export class ContentDto extends TenantOwnedDto {
  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'PDF', 'URL', 'TEXT'] })
  type!: string;

  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED', 'TRASHED'] })
  status!: string;

  @ApiProperty({ enum: ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'] })
  orientation!: string;

  @ApiPropertyOptional({ nullable: true, description: 'External address for URL content.' })
  url?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Body for TEXT content.' })
  textBody?: string | null;

  @ApiPropertyOptional({ nullable: true })
  textStyle?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Bytes, as a STRING — a 64-bit column serialised via BigInt.toJSON.',
  })
  fileSize?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mimeType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  originalFileName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Pages in a PDF.' })
  pageCount?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Default dwell time when scheduled.' })
  durationSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  expiresAt?: string | null;

  @ApiProperty({
    description: 'Derived at read time from expiresAt — there is no such column.',
  })
  isExpired!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  archivedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  trashedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdById?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedById?: string | null;

  @ApiProperty({ type: [TagDto] })
  tags!: TagDto[];
}

/** A schedule target as nested in a schedule. */
export class ScheduleTargetDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['SCREEN', 'SCREEN_GROUP', 'LOCATION', 'COMPANY'] })
  targetType!: string;

  @ApiProperty({ description: "The referenced entity, or 'company' for a company-wide target." })
  targetId!: string;
}

/** The playlist summary a schedule carries inline. */
export class PlaylistRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  status!: string;
}

/**
 * A schedule as the API returns it.
 *
 * `SchedulesService.toView` is an explicit allow-list rather than a spread, so
 * this is a direct transcription of it — including `targetCount`, which is
 * computed from the targets array and is not a column.
 */
export class ScheduleDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playlistId?: string | null;

  @ApiPropertyOptional({ type: PlaylistRefDto, nullable: true })
  playlist?: PlaylistRefDto | null;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] })
  status!: string;

  @ApiProperty({ enum: ['ONE_TIME', 'RECURRING', 'ALWAYS'] })
  scheduleType!: string;

  @ApiProperty({ description: 'Higher wins when two schedules cover the same screen and time.' })
  priority!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '09:00' })
  startTime?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '17:30' })
  endTime?: string | null;

  @ApiProperty()
  isAllDay!: boolean;

  @ApiProperty({ type: [Number], description: '0 = Sunday.' })
  daysOfWeek!: number[];

  @ApiPropertyOptional({
    nullable: true,
    example: 'Asia/Riyadh',
    description:
      'IANA zone the times resolve against; a bare city name runs the schedule hours off.',
  })
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  recurrence?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  createdById?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedById?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  archivedAt?: string | null;

  @ApiProperty({ type: [ScheduleTargetDto] })
  targets!: ScheduleTargetDto[];

  @ApiProperty({ description: 'targets.length, computed — not a column.' })
  targetCount!: number;
}

/** The content summary a playlist item carries inline. */
export class PlaylistItemContentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'PDF', 'URL', 'TEXT'] })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'] })
  orientation!: string;

  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED', 'TRASHED'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  expiresAt?: string | null;

  @ApiProperty({ description: 'Derived at read time — no such column.' })
  isExpired!: boolean;
}

export class PlaylistItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contentId!: string;

  @ApiProperty()
  position!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Per-item override.' })
  durationSeconds?: number | null;

  @ApiProperty()
  playFullVideo!: boolean;

  @ApiPropertyOptional({ nullable: true })
  pdfPageDurationSeconds?: number | null;

  @ApiPropertyOptional({ nullable: true })
  transitionType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  settings?: Record<string, unknown> | null;

  @ApiProperty({ description: 'What actually plays, after per-item and per-type defaults.' })
  effectiveDurationSeconds!: number;

  @ApiProperty({ description: 'False when the referenced content cannot play.' })
  valid!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the item cannot play — expired, archived, trashed or deleted content.',
  })
  issue?: string | null;

  @ApiProperty({ type: PlaylistItemContentDto })
  content!: PlaylistItemContentDto;
}

/** A playlist row as the LIST endpoint returns it (no items, just a count). */
export class PlaylistSummaryDto extends TenantOwnedDto {
  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  status!: string;

  @ApiProperty({ description: 'From a Prisma _count; the list does not load the items.' })
  itemCount!: number;

  @ApiPropertyOptional({ nullable: true })
  createdById?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedById?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  archivedAt?: string | null;
}

/**
 * A playlist as the DETAIL endpoint returns it.
 *
 * Deliberately a different class from the list row. `toDetailView` computes
 * seven fields that exist in no column — the validity counts, the total
 * duration, the orientation profile, `schedulable` and the warnings — and none
 * of them are present on the list. Describing both with one schema would
 * promise the list endpoint fields it never sends.
 */
export class PlaylistDetailDto extends PlaylistSummaryDto {
  @ApiProperty({ type: [PlaylistItemDto] })
  items!: PlaylistItemDto[];

  @ApiProperty()
  validItemCount!: number;

  @ApiProperty()
  invalidItemCount!: number;

  @ApiProperty({ description: 'Sum over VALID items only.' })
  totalDurationSeconds!: number;

  @ApiProperty({ enum: ['LANDSCAPE', 'PORTRAIT', 'MIXED', 'UNKNOWN'] })
  orientationProfile!: string;

  @ApiProperty({ description: 'At least one playable item AND status ACTIVE.' })
  schedulable!: boolean;

  @ApiProperty({ type: [String] })
  warnings!: string[];
}
