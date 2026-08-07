import { ContentType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Content response shapes that are not the content row itself. `ContentDto`
 * lives in `common/dto/entity-response.dto.ts`; these are the computed reads —
 * the preview union and the library's usage card.
 */

/**
 * `GET /content/{id}/preview` returns one of THREE shapes, chosen by type.
 *
 * A URL item returns the URL it points at; a TEXT item returns its body and
 * styling and no URL at all; a file returns a short-lived signed URL and the
 * mime type. Documenting any single one of them — and the file shape is the
 * obvious pick — would tell a client that `url` is always there, when for a
 * TEXT item it is never there. That is the same half-truth `POST /auth/login`
 * would have told by documenting only the token response, and it is handled the
 * same way: a `oneOf` over three classes, with `type` as the discriminator.
 */
export class UrlPreviewDto {
  @ApiProperty({ enum: [ContentType.URL] })
  type!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The external URL the item points at. Not signed and not proxied.',
  })
  url?: string | null;
}

export class TextPreviewDto {
  @ApiProperty({ enum: [ContentType.TEXT] })
  type!: string;

  @ApiPropertyOptional({ nullable: true })
  textBody?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Font, colour and alignment as stored; the player renders it.',
  })
  textStyle?: Record<string, unknown> | null;

  // No `url`. A TEXT item has no file and nothing to sign.
}

export class FilePreviewDto {
  @ApiProperty({ enum: [ContentType.IMAGE, ContentType.VIDEO, ContentType.PDF] })
  type!: string;

  @ApiProperty({
    description:
      'Short-lived signed URL. Re-read it rather than caching — the endpoint exists because ' +
      'the storage key itself is never published.',
  })
  url!: string;

  @ApiPropertyOptional({ nullable: true })
  mimeType?: string | null;
}

/** Storage side of the library usage card. */
export class ContentStorageUsageDto {
  @ApiProperty({
    description:
      'A string, matching `ContentDto.fileSize` — the raw BigInt column it sums. The two used ' +
      'to disagree: this was passed through Number() and documented as a deliberate split, ' +
      'which meant the same quantity had two encodings and adding them together was wrong.',
    example: '10737418240',
  })
  usedBytes!: string;

  @ApiProperty({ description: 'The same figure in GB, rounded — what the card displays.' })
  usedGb!: number;

  @ApiPropertyOptional({ nullable: true, description: 'null means unlimited on this plan.' })
  limitGb?: number | null;

  @ApiProperty()
  unlimited!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null when the plan is unlimited, or when the limit is zero.',
  })
  percentUsed?: number | null;

  @ApiProperty({
    enum: ['ok', 'approaching', 'exceeded', 'grace', 'blocked'],
    description:
      'Whole-account usage status, not storage-specific — it reflects every metered resource, ' +
      'so it can read `exceeded` while storage itself is fine.',
  })
  status!: string;

  @ApiProperty({ description: 'True while an over-limit account is inside its grace window.' })
  inGrace!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  gracePeriodEndsAt?: string | null;
}

/** Counts side of the library usage card. */
export class ContentCountsDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Counts per ContentStatus. Built straight from a groupBy, so a status with no rows is ' +
      'ABSENT rather than zero — unlike the Super Admin overview, which seeds every enum ' +
      'member first. Read it with a default.',
    example: { ACTIVE: 42, ARCHIVED: 3 },
  })
  byStatus!: Record<string, number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Counts per ContentType, excluding DELETED. Same groupBy caveat as byStatus.',
    example: { IMAGE: 30, VIDEO: 12 },
  })
  byType!: Record<string, number>;
}

/** GET /content/usage. */
export class ContentUsageDto {
  @ApiProperty({ type: ContentStorageUsageDto })
  storage!: ContentStorageUsageDto;

  @ApiProperty({ type: ContentCountsDto })
  counts!: ContentCountsDto;
}
