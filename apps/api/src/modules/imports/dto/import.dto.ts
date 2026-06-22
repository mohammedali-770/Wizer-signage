import { ImportType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListImportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportType)
  type?: ImportType;
}
