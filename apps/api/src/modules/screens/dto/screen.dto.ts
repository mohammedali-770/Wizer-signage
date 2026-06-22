import { Orientation, ScreenStatus, ScreenUse } from '@prisma/client';
import { OmitType, PartialType } from '@nestjs/swagger';
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
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsEnum(ScreenUse)
  use?: ScreenUse;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  groupIds?: string[];

  // Audio.
  @IsOptional()
  @IsBoolean()
  audioEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  volume?: number;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsObject()
  muteSchedule?: Record<string, unknown>;

  // Active hours.
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  // Kiosk / device.
  @IsOptional()
  @IsBoolean()
  kioskEnabled?: boolean;

  /** Screen-specific kiosk exit PIN (4-8 digits) — stored hashed, never raw. */
  @IsOptional()
  @Matches(/^\d{4,8}$/, { message: 'kioskPin must be 4-8 digits.' })
  kioskPin?: string;

  @IsOptional()
  @IsBoolean()
  autoStartEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  powerControlMode?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  heartbeatIntervalSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Placeholder reference — Content selection connects in Phase 4. */
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

export class MoveScreenDto {
  /** Target location id, or null to unassign. */
  @IsOptional()
  @IsString()
  locationId?: string | null;
}

export class AssignTagsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds!: string[];
}

export class AssignGroupsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  groupIds!: string[];
}

export class SetKioskPinDto {
  @Matches(/^\d{4,8}$/, { message: 'pin must be 4-8 digits.' })
  pin!: string;
}

export class BulkScreenTagDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];

  @IsString()
  tagId!: string;

  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}

export class BulkScreenGroupDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];

  @IsString()
  groupId!: string;

  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}
