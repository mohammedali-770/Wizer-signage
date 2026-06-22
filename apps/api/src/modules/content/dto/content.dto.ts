import { ContentStatus, ContentType, Orientation } from '@prisma/client';
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

/** Metadata accompanying a multipart file upload (the file is sent separately). */
export class UploadContentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  /** Comma-separated CONTENT/BOTH tag ids. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tags?: string;
}

export class CreateUrlContentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];
}

export class CreateTextContentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MaxLength(5000)
  textBody!: string;

  @IsOptional()
  @IsObject()
  textStyle?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  tagIds?: string[];
}

export class UpdateContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(Orientation)
  orientation?: Orientation;

  /** Set a date, or null to clear the expiry. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86_400)
  durationSeconds?: number;

  // URL content only.
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  // TEXT content only.
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  textBody?: string;

  @IsOptional()
  @IsObject()
  textStyle?: Record<string, unknown>;

  /** Replace the content's tags (CONTENT/BOTH only). */
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
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  contentIds!: string[];
}

export class BulkContentTagDto extends BulkContentDto {
  @IsString()
  tagId!: string;

  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';
}
