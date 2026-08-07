import { Orientation, ScreenStatus, ScreenUse } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { WorkingHoursDto } from '../../../common/dto/working-hours.dto';

export class CreateScreenDto {
  @ApiProperty({ maxLength: 120, example: 'Lobby left' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description: 'Your own reference. Unlike a location code this is NOT pattern-checked.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Optional at creation — a screen may exist with no location. Moving it later goes through ' +
      'POST /screens/{id}/move, not through an update.',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ enum: Object.values(ScreenUse) })
  @IsOptional()
  @IsEnum(ScreenUse)
  use?: ScreenUse;

  @ApiPropertyOptional({
    enum: Object.values(Orientation),
    description:
      'Content whose orientation does not match is not rejected — it plays, and the mismatch ' +
      'surfaces as an orientationWarning on schedule validation.',
  })
  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'Accepted only at CREATION. Omitted from the update body — tags are changed through ' +
      'PUT /screens/{id}/tags, which REPLACES the set.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description: 'Creation only, like tagIds — see PUT /screens/{id}/groups.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  groupIds?: string[];

  // Audio.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  audioEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  volume?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'OPAQUE. Validated as "is an object" and nothing more — no key, type or shape is checked, ' +
      'so a malformed schedule is stored without complaint and simply never mutes anything.',
  })
  @IsOptional()
  @IsObject()
  muteSchedule?: Record<string, unknown>;

  // Active hours.
  @ApiPropertyOptional({
    type: WorkingHoursDto,
    description: 'Overrides the location default, which overrides the company default.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  // Kiosk / device.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kioskEnabled?: boolean;

  /** Screen-specific kiosk exit PIN (4-8 digits) — stored hashed, never raw. */
  @ApiPropertyOptional({
    description:
      'Plaintext 4-8 digit PIN, hashed on receipt and never returned (responses carry ' +
      '`hasKioskPin`). Accepted only at CREATION — omitted from the update body; changing it ' +
      'later goes through PUT /screens/{id}/kiosk-pin.',
    pattern: '^\\d{4,8}$',
    example: '4821',
  })
  @IsOptional()
  @Matches(/^\d{4,8}$/, { message: 'kioskPin must be 4-8 digits.' })
  kioskPin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoStartEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'A free-form string, NOT an enum — any value up to 40 characters is accepted and stored, ' +
      'including one no player understands.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  powerControlMode?: string;

  @ApiPropertyOptional({
    description: 'Overrides the company default. Read back as 60 when unset.',
    minimum: 10,
    maximum: 3600,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  heartbeatIntervalSeconds?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Shown when nothing is scheduled. Ownership resolved server-side.',
  })
  @IsOptional()
  @IsString()
  fallbackContentId?: string;
}

/** Update scalar screen fields; tags/groups/kioskPin use dedicated endpoints. */
export class UpdateScreenDto extends PartialType(
  OmitType(CreateScreenDto, ['tagIds', 'groupIds', 'kioskPin'] as const),
) {}

export class ListScreensQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsEnum(ScreenStatus)
  status?: ScreenStatus;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsEnum(ScreenUse)
  use?: ScreenUse;

  @IsOptional()
  @IsString()
  tagId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'name'])
  sort?: 'createdAt' | 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/**
 * The field is `@IsOptional()`, so the schema calls it optional — but the SERVICE
 * requires it to be PRESENT. Omitting it is a 400 ("locationId is required (use
 * null to unassign)"), because silently unassigning a screen on an empty body
 * would be a destructive default. Explicit `null` — and `''` — unassign.
 *
 * So the published shape is wider than what is accepted, in the one direction a
 * schema cannot express: required-but-nullable.
 */
export class MoveScreenDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'MUST BE PRESENT despite being optional in the schema: omitting it is a 400. Send an id ' +
      'to move, or null (or an empty string) to unassign.',
  })
  @IsOptional()
  @IsString()
  locationId?: string | null;
}

export class AssignTagsDto {
  @ApiProperty({
    type: [String],
    maxItems: 50,
    description:
      "REPLACES the screen's tags — `[]` clears them. Capped at 50, where the BULK endpoints " +
      'allow 500 screens; the two limits count different things and are not comparable.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds!: string[];
}

export class AssignGroupsDto {
  @ApiProperty({
    type: [String],
    maxItems: 50,
    description: "REPLACES the screen's groups — `[]` clears them.",
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  groupIds!: string[];
}

export class SetKioskPinDto {
  @ApiProperty({
    description: 'Plaintext 4-8 digit PIN, hashed on receipt and never returned.',
    pattern: '^\\d{4,8}$',
    example: '4821',
  })
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits.' })
  pin!: string;
}

/**
 * Bulk tagging is ADDITIVE or SUBTRACTIVE — the opposite model to
 * {@link AssignTagsDto}, which replaces. Same concept, two endpoints, two
 * semantics: `action` decides here, and there the array is the whole truth.
 */
export class BulkScreenTagDto {
  @ApiProperty({ type: [String], maxItems: 500, description: 'Screens to change. Cap is 500.' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];

  @ApiProperty({ description: 'One tag per call — this is not an array.' })
  @IsString()
  tagId!: string;

  @ApiProperty({
    enum: ['add', 'remove'],
    description: "Adds to or removes from each screen's existing tags; it does not replace them.",
  })
  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}

/** Additive/subtractive, like {@link BulkScreenTagDto}. */
export class BulkScreenGroupDto {
  @ApiProperty({ type: [String], maxItems: 500 })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];

  @ApiProperty({ description: 'One group per call.' })
  @IsString()
  groupId!: string;

  @ApiProperty({ enum: ['add', 'remove'] })
  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}
