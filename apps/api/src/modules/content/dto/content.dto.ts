import { ContentStatus, ContentType, Orientation } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Metadata accompanying a multipart file upload (the file is sent separately).
 *
 * The ONLY `multipart/form-data` body in the API, and it pays for that twice.
 * Every field arrives as a string, so `durationSeconds` needs an explicit
 * `@Type(() => Number)` coercion the JSON bodies do not — and tags cannot be an
 * array at all. See the note on `tags`.
 */
export class UploadContentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(Orientation) })
  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Sent as a form field, so it arrives as text and is coerced to a number here. The JSON ' +
      'creators take a real number.',
    minimum: 1,
    maximum: 86400,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  /** Comma-separated CONTENT/BOTH tag ids. */
  @ApiPropertyOptional({
    description:
      'A COMMA-SEPARATED STRING, not an array — and note the field is called `tags`, where the ' +
      'URL and TEXT creators take a `tagIds` array. Same concept, three creation endpoints, two ' +
      'names and two encodings; multipart cannot carry a JSON array, and the API does not hide ' +
      'that. A client sharing one tag-picker across the three must special-case this one.',
    maxLength: 2000,
    example: 'tag_a1b2,tag_c3d4',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tags?: string;
}

export class CreateUrlContentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    format: 'uri',
    description:
      'An absolute http(s) URL — the protocol is REQUIRED, so `example.com` is rejected. Note ' +
      'the player skips URL content entirely when offline, since there is nothing to cache.',
    example: 'https://example.com/dashboard',
  })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @ApiPropertyOptional({ enum: Object.values(Orientation) })
  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description: 'An ARRAY here — the multipart upload takes a comma-separated `tags` string.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];
}

export class CreateTextContentDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ maxLength: 5000, description: 'The announcement body.' })
  @IsString()
  @MaxLength(5000)
  textBody!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'OPAQUE styling hints. Checked only for being an object — no key is validated, so an ' +
      'unrecognised style is stored and ignored by the player rather than rejected here.',
  })
  @IsOptional()
  @IsObject()
  textStyle?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: Object.values(Orientation) })
  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description: 'An ARRAY here — the multipart upload takes a comma-separated `tags` string.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];
}

/**
 * One update body for every content TYPE, so several fields apply only to some
 * of them: `url` to URL content, `textBody`/`textStyle` to TEXT. The schema
 * cannot express that, and sending an inapplicable field is not a validation
 * error here — which is why each one says what it belongs to.
 */
export class UpdateContentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(Orientation) })
  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  /** Set a date, or null to clear the expiry. */
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Explicit `null` CLEARS the expiry; omitting the field leaves it untouched. The two are ' +
      'different, and only null un-expires content.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  // URL content only.
  @ApiPropertyOptional({
    format: 'uri',
    description: 'URL content only. Absolute http(s), protocol required.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  // TEXT content only.
  @ApiPropertyOptional({ maxLength: 5000, description: 'TEXT content only.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  textBody?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'TEXT content only, and opaque — see the create DTO.',
  })
  @IsOptional()
  @IsObject()
  textStyle?: Record<string, unknown>;

  /** Replace the content's tags (CONTENT/BOTH only). */
  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'REPLACES the tags — `[]` clears them. An ARRAY here, unlike the comma-separated `tags` ' +
      'string the multipart upload takes.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];
}

export class ListContentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ContentType)
  type?: ContentType;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsString()
  tagId?: string;

  /** Expiry filter: active (valid), expiring (<= 7 days), expired, none (no date). */
  @IsOptional()
  @IsIn(['active', 'expiring', 'expired', 'none'])
  expiry?: 'active' | 'expiring' | 'expired' | 'none';

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'title', 'size', 'expiry'])
  sort?: 'newest' | 'oldest' | 'title' | 'size' | 'expiry';
}

export class BulkContentDto {
  @ApiProperty({ type: [String], maxItems: 500 })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  contentIds!: string[];
}

/**
 * Additive/subtractive, unlike `UpdateContentDto.tagIds`, which replaces. Same
 * pairing as screens: the bulk endpoint takes an `action`, the per-item one
 * takes the whole set.
 */
export class BulkContentTagDto extends BulkContentDto {
  @ApiProperty({ description: 'One tag per call — not an array.' })
  @IsString()
  tagId!: string;

  @ApiProperty({
    enum: ['add', 'remove'],
    description: "Adds to or removes from each item's existing tags; does not replace them.",
  })
  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}
