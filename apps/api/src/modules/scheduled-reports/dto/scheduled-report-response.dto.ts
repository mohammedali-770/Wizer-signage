import { ReportDeliveryStatus, ReportFormat, ReportFrequency, ReportType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Scheduled-report response shapes for the OpenAPI contract. See
 * `common/dto/api-response.dto.ts` for why these are classes and not the
 * interfaces the service already returns.
 *
 * Enums come from `@prisma/client` rather than being written out — see the note
 * in `super-admin/dto/super-admin-response.dto.ts` for what hand-listing them
 * cost.
 */

/**
 * One attempt to render and email a report.
 *
 * Transcribed from `ScheduledReportService.deliveryView`, which is an
 * allow-list — it drops `companyId` and `scheduledReportId`.
 *
 * It also drops `fileStorageKey`, which it used to return. `ContentService
 * .toView` and `ScreenshotService.list` both strip their storage key and hand
 * back a short-lived signed URL instead, on the rule that the bucket layout is
 * internal; this view was the one place that rule was not applied. It was never
 * directly exploitable — no endpoint signs a caller-supplied key, every signing
 * call passes a key read from a row the caller already owns — and a client
 * could do nothing with the value, which is exactly why removing it costs
 * nothing. Recipients get a signed URL by email; the key itself was only ever
 * a description of where the bucket puts things.
 */
export class ReportDeliveryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: Object.values(ReportDeliveryStatus) })
  status!: string;

  @ApiProperty({
    type: [String],
    description: 'The addresses this attempt was sent to, as resolved at run time.',
  })
  recipientEmails!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why the delivery failed. Set when every recipient email failed to send.',
  })
  error?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'null when the status is FAILED — the file rendered but reached nobody.',
  })
  sentAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/**
 * A scheduled report as the list and write endpoints return it.
 *
 * `toView` is an allow-list: no `companyId` (implied by the caller's token) and
 * no `createdById`.
 */
export class ScheduledReportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Object.values(ReportType) })
  reportType!: string;

  @ApiProperty({ enum: Object.values(ReportFormat), description: 'PDF renders as print HTML.' })
  format!: string;

  @ApiProperty({ enum: Object.values(ReportFrequency) })
  frequency!: string;

  @ApiProperty({
    type: [String],
    description: 'Recipient email addresses. Stored as a JSON array on the row.',
    example: ['ops@example.com'],
  })
  recipients!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Report-type-specific filters, stored as free-form JSON. `{}` when unset.',
  })
  filters!: Record<string, unknown>;

  @ApiProperty({ description: 'A disabled report keeps its schedule but is never run.' })
  enabled!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastRunAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'When the maintenance sweep will next pick this up.',
  })
  nextRunAt?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * GET /scheduled-reports/{id} — the report PLUS its delivery history.
 *
 * A separate class from `ScheduledReportDto` for the same reason the playlist
 * list and detail rows are separate: the list endpoint loads no deliveries, so
 * one shared schema would tell a client the list carries a history it never
 * sends.
 */
export class ScheduledReportDetailDto extends ScheduledReportDto {
  @ApiProperty({
    type: [ReportDeliveryDto],
    description: 'The 20 most recent attempts, newest first. Not paginated and not configurable.',
  })
  deliveries!: ReportDeliveryDto[];
}
