import { PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateScreenGroupDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

export class UpdateScreenGroupDto extends PartialType(CreateScreenGroupDto) {}

export class ListScreenGroupsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}

export class GroupScreensDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];
}
