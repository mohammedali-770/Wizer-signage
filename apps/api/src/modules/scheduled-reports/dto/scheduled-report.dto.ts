import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportFormat, ReportFrequency, ReportType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateScheduledReportDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: Object.values(ReportType) })
  @IsEnum(ReportType)
  reportType!: ReportType;

  @ApiPropertyOptional({ enum: Object.values(ReportFormat) })
  @ApiPropertyOptional({ enum: Object.values(ReportFormat) })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @ApiProperty({
    enum: Object.values(ReportFrequency),
    description:
      'Delivery cadence. Runs are driven by the maintenance cron, not an in-process timer.',
  })
  @IsEnum(ReportFrequency)
  frequency!: ReportFrequency;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 50,
    description:
      'At least one address — a report with no recipients is refused rather than created and ' +
      'silently undelivered. REPLACES the list on update. One invalid address rejects the array.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  recipients!: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'OPAQUE and report-type specific. Checked only for being an object, so a filter key the ' +
      'report does not understand is stored and ignored rather than rejected.',
  })
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Opaque — see create.',
  })
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Opaque — see create.',
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

export class UpdateScheduledReportDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: Object.values(ReportType) })
  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;

  @ApiPropertyOptional({ enum: Object.values(ReportFormat) })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @ApiPropertyOptional({ enum: Object.values(ReportFrequency) })
  @IsOptional()
  @IsEnum(ReportFrequency)
  frequency?: ReportFrequency;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'REPLACES the recipient list. Note there is NO ArrayMinSize here, unlike create — so an ' +
      'update may set it to `[]`, leaving a report enabled with nobody to deliver it to.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  recipients?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Opaque — see create.',
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Disabled reports keep their config and stop being delivered.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListScheduledReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(ReportType) })
  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;
}
