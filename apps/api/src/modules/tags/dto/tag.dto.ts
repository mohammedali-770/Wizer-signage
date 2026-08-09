import { TagType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateTagDto {
  @ApiProperty({ maxLength: 60, example: 'Lobby' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({
    enum: Object.values(TagType),
    description:
      'What the tag may be attached to. Omitted means the schema default, so a client that ' +
      'wants a content-only tag must say so explicitly.',
  })
  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;

  @ApiPropertyOptional({
    description:
      'Hex colour. The leading # is OPTIONAL and is NOT normalised — `#2563eb` and `2563eb` ' +
      'are both accepted and both stored verbatim, so a client comparing colours must handle ' +
      'either. 3 to 8 digits, which admits the 4- and 8-digit forms carrying alpha.',
    pattern: '^#?[0-9A-Fa-f]{3,8}$',
    example: '#2563eb',
  })
  @IsOptional()
  @IsString()
  @Matches(/^#?[0-9A-Fa-f]{3,8}$/, { message: 'color must be a hex value (e.g. #2563eb).' })
  color?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/**
 * Every field optional, inherited from {@link CreateTagDto}.
 *
 * `PartialType` re-emits the parent's `@ApiProperty` metadata with `required`
 * dropped, so the constraints above are published here too rather than this
 * appearing as an empty object.
 */
export class UpdateTagDto extends PartialType(CreateTagDto) {}

export class ListTagsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive tag-name search.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: Object.values(TagType),
    description: 'Exact stored tag type. Mutually exclusive with applicableTo.',
  })
  @IsOptional()
  @IsEnum(TagType)
  type?: TagType;

  @ApiPropertyOptional({
    enum: ['SCREEN', 'CONTENT'],
    description:
      'Selector-oriented applicability filter. SCREEN returns SCREEN+BOTH; CONTENT returns CONTENT+BOTH. Mutually exclusive with exact `type`.',
  })
  @IsOptional()
  @IsIn(['SCREEN', 'CONTENT'])
  applicableTo?: 'SCREEN' | 'CONTENT';
}
