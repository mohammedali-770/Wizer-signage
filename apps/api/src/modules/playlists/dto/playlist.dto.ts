import { PlaylistStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** An item supplied when creating a playlist with initial content. */
export class PlaylistItemInputDto {
  @ApiProperty({ description: 'Library content id. Ownership is resolved server-side.' })
  @IsString()
  contentId!: string;

  @ApiPropertyOptional({
    description:
      "How long this item shows, in seconds. Falls back to the content's own duration when " +
      'omitted — so leaving it out is not the same as sending a value.',
    minimum: 1,
    maximum: 86400,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Play the whole video rather than cutting at durationSeconds. When true, durationSeconds ' +
      'stops governing this item.',
  })
  @IsOptional()
  @IsBoolean()
  playFullVideo?: boolean;

  @ApiPropertyOptional({
    description: 'Per-page dwell for PDFs. Meaningless for other types, and not rejected there.',
    minimum: 1,
    maximum: 86400,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  pdfPageDurationSeconds?: number;

  @ApiPropertyOptional({
    description: 'Free-form string, NOT an enum — an unknown transition is stored and ignored.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  transitionType?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'OPAQUE. Checked only for being an object; no key is validated.',
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class CreatePlaylistDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** ACTIVE (default) or DRAFT. Archiving is done via the archive endpoint. */
  @ApiPropertyOptional({
    enum: [PlaylistStatus.ACTIVE, PlaylistStatus.DRAFT],
    description:
      'A NARROWER set than the PlaylistStatus enum responses carry: ARCHIVED cannot be set ' +
      'here, and archiving goes through its own endpoint.',
  })
  @IsOptional()
  @IsIn([PlaylistStatus.ACTIVE, PlaylistStatus.DRAFT])
  status?: PlaylistStatus;

  @ApiPropertyOptional({
    type: [PlaylistItemInputDto],
    maxItems: 500,
    description:
      'Optional initial items, in playback order. A playlist may be created empty — and an ' +
      'empty one is not schedulable, which validation reports rather than refusing here.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemInputDto)
  items?: PlaylistItemInputDto[];
}

/**
 * Scalar fields only. `items` is deliberately absent: the item list is managed
 * through the add/update/reorder item endpoints, so an update cannot replace
 * the contents of a playlist wholesale.
 */
export class UpdatePlaylistDto {
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

  @ApiPropertyOptional({
    enum: [PlaylistStatus.ACTIVE, PlaylistStatus.DRAFT],
    description: 'ARCHIVED is not settable here — see the archive endpoint.',
  })
  @IsOptional()
  @IsIn([PlaylistStatus.ACTIVE, PlaylistStatus.DRAFT])
  status?: PlaylistStatus;
}

export class ListPlaylistsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PlaylistStatus)
  status?: PlaylistStatus;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'title', 'updated'])
  sort?: 'newest' | 'oldest' | 'title' | 'updated';
}

/** Add a single item to an existing playlist (appended unless `position` given). */
export class AddPlaylistItemDto extends PlaylistItemInputDto {
  /** 0-based insert index; out-of-range clamps to the end. */
  @ApiPropertyOptional({
    description:
      '0-based insert index. Appended when omitted, and an index past the end CLAMPS rather ' +
      'than erroring — so a stale index silently appends instead of failing.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

/**
 * {@link PlaylistItemInputDto} minus `contentId` — an item's content cannot be
 * swapped in place. To show something else, remove the item and add another.
 */
export class UpdatePlaylistItemDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  playFullVideo?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 86400, description: 'PDFs only.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  pdfPageDurationSeconds?: number;

  @ApiPropertyOptional({ maxLength: 40, description: 'Free-form, not an enum.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  transitionType?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Opaque.' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

/** A full, ordered list of the playlist's item ids (defines the new order). */
export class ReorderPlaylistItemsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 500,
    description:
      "The COMPLETE ordered list of the playlist's item ids — this defines the new order, it " +
      'is not a partial move. Note these are ITEM ids, not content ids: the same content can ' +
      'appear twice in a playlist, so content ids would be ambiguous.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  itemIds!: string[];
}

export class DuplicatePlaylistDto {
  @ApiPropertyOptional({
    description: 'Title for the copy. A default derived from the original is used when omitted.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
