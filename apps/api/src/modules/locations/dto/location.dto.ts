import { LocationStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
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

export class CreateLocationDto {
  @ApiProperty({ maxLength: 120, example: 'Downtown Branch' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Your own reference for the branch. Letters, digits, hyphens and underscores only — no ' +
      'spaces and no dots, which rules out most codes copied out of a spreadsheet.',
    maxLength: 40,
    pattern: '^[A-Za-z0-9_-]+$',
    example: 'DT-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code may contain letters, digits, hyphens, underscores.',
  })
  code?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({
    description: 'Decimal degrees. Independent of longitude — neither requires the other.',
    minimum: -90,
    maximum: 90,
    example: 25.2048,
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, example: 55.2708 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description:
      'IANA zone name. Only length-checked here, NOT validated against the tz database — an ' +
      'unrecognised value is stored and surfaces later as wrong scheduling times, not as a 400.',
    maxLength: 60,
    example: 'Asia/Dubai',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** New locations may start ACTIVE or INACTIVE — not ARCHIVED (quota-exempt). */
  @ApiPropertyOptional({
    enum: [LocationStatus.ACTIVE, LocationStatus.INACTIVE],
    description:
      'A NARROWER set than the LocationStatus enum the API returns: ARCHIVED cannot be set here, ' +
      'because archived locations are exempt from the plan quota and creating one already ' +
      'archived would mint free capacity. Settable only at creation — it is omitted from the ' +
      'update body entirely, so this field cannot be used to archive later either.',
  })
  @IsOptional()
  @IsIn([LocationStatus.ACTIVE, LocationStatus.INACTIVE])
  status?: LocationStatus;

  @ApiPropertyOptional({ type: WorkingHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkingHoursDto)
  workingHours?: WorkingHoursDto;

  @ApiPropertyOptional({
    description:
      'Content shown when nothing is scheduled. Only checked for being a string here; whether ' +
      'the id exists and belongs to your company is resolved server-side.',
  })
  @IsOptional()
  @IsString()
  fallbackContentId?: string;
}

/**
 * Every field optional AND `status` removed — see the note on that field.
 *
 * `PartialType`/`OmitType` re-emit the parent's `@ApiProperty` metadata, so the
 * constraints above are published here too, minus the omitted field.
 */
export class UpdateLocationDto extends PartialType(
  OmitType(CreateLocationDto, ['status'] as const),
) {}

export class ListLocationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(LocationStatus)
  status?: LocationStatus;

  @IsOptional()
  @IsIn(['createdAt', 'name'])
  sort?: 'createdAt' | 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
