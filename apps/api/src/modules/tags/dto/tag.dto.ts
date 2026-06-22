import { TagType } from '@prisma/client';
import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateTagDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;

  @IsOptional()
  @IsString()
  @Matches(/^#?[0-9A-Fa-f]{3,8}$/, { message: 'color must be a hex value (e.g. #2563eb).' })
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class UpdateTagDto extends PartialType(CreateTagDto) {}

export class ListTagsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;
}
