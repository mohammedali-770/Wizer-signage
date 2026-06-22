import { PlaylistStatus } from '@prisma/client';
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
  @IsString()
  contentId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @IsOptional()
  @IsBoolean()
  playFullVideo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  pdfPageDurationSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  transitionType?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class CreatePlaylistDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** ACTIVE (default) or DRAFT. Archiving is done via the archive endpoint. */
  @IsOptional()
  @IsIn([PlaylistStatus.ACTIVE, PlaylistStatus.DRAFT])
  status?: PlaylistStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemInputDto)
  items?: PlaylistItemInputDto[];
}

export class UpdatePlaylistDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

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
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdatePlaylistItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @IsOptional()
  @IsBoolean()
  playFullVideo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  pdfPageDurationSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  transitionType?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

/** A full, ordered list of the playlist's item ids (defines the new order). */
export class ReorderPlaylistItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  itemIds!: string[];
}

export class DuplicatePlaylistDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
