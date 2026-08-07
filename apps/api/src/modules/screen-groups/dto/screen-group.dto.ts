import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateScreenGroupDto {
  @ApiProperty({ maxLength: 120, example: 'Checkout displays' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Free-form label, not an enum — any string up to 60 characters.',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

/** Every field optional; constraints inherited from {@link CreateScreenGroupDto}. */
export class UpdateScreenGroupDto extends PartialType(CreateScreenGroupDto) {}

export class ListScreenGroupsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}

export class GroupScreensDto {
  @ApiProperty({
    type: [String],
    maxItems: 500,
    description:
      'Screen ids to add to or remove from the group. Capped at 500 per call — a larger fleet ' +
      'has to be sent in batches, and exceeding the cap is a 400, not a silent truncation.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  screenIds!: string[];
}
