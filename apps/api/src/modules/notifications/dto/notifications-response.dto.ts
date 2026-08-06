import { AlertStatus, NotificationChannel, NotificationSeverity } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Notification + alert response shapes for the OpenAPI contract. See
 * `common/dto/api-response.dto.ts` for why these are classes and not the
 * interfaces the services already return.
 *
 * `type` is a plain String column on both models, not an enum — the values are
 * dotted event names minted in code (`screen.offline`, `sync.failed`,
 * `subscription.expiring`) and nothing constrains the set at the database
 * level. Documented as a string with examples rather than as a closed union: a
 * generated client that typed it as an enum would reject an event the API added
 * without a schema change, which is exactly the case a free-text column exists
 * to allow.
 */

/**
 * A dashboard notification for the calling user.
 *
 * `NotificationService.toView` is an allow-list. It drops `companyId`, `userId`
 * (both implied — this endpoint only ever returns the caller's own rows),
 * `channels` and `emailedAt` (delivery bookkeeping, not something the bell UI
 * has any use for).
 */
export class NotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description: 'Dotted event name. Free-form: a new event type needs no schema change.',
    example: 'screen.offline',
  })
  type!: string;

  @ApiProperty({ enum: Object.values(NotificationSeverity) })
  severity!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  body?: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Event-specific payload, e.g. the screen id to deep-link to. `{}` when unset.',
  })
  data!: Record<string, unknown>;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'null means unread — there is no separate boolean.',
  })
  readAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** GET /notifications/unread-count — the bell badge. */
export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  unreadCount!: number;
}

/**
 * One notification-preference row.
 *
 * Returned as the raw Prisma row — there is no view — so this is transcribed
 * from the model. A preference is absent until the user changes it; the
 * effective value falls back to a default in `isEnabled`, so an empty list
 * means "everything at its default", not "everything off".
 */
export class NotificationPreferenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional({ nullable: true })
  companyId?: string | null;

  @ApiProperty({ enum: Object.values(NotificationChannel) })
  channel!: string;

  @ApiProperty({ description: 'The dotted event name this preference applies to.' })
  eventType!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * An operational alert.
 *
 * `AlertService.toView` is an allow-list, and what it leaves out is the
 * interesting part: `dedupeKey` and `lastNotifiedAt` are both internal
 * scheduling state. `dedupeKey` is what keeps an unresolved alert from
 * re-firing, and `lastNotifiedAt` drives the CRITICAL re-notification cadence —
 * neither means anything to a client, and publishing them would invite one to
 * reason about de-duplication the server owns. `updatedAt` is dropped too;
 * `triggeredAt` and the lifecycle timestamps are what a reader wants.
 */
export class AlertDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null for a platform/system alert, which only a Super Admin sees.',
  })
  companyId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  screenId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  deviceId?: string | null;

  @ApiProperty({
    description: 'Dotted event name. Free-form, same as a notification type.',
    example: 'sync.failed',
  })
  type!: string;

  @ApiProperty({
    enum: Object.values(NotificationSeverity),
    description: 'Shares NotificationSeverity — there is no separate alert-severity enum.',
  })
  severity!: string;

  @ApiProperty({ enum: Object.values(AlertStatus) })
  status!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  message?: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Alert-specific context. `{}` when unset.',
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time', description: 'When the condition was first detected.' })
  triggeredAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  acknowledgedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  acknowledgedById?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  resolvedAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
