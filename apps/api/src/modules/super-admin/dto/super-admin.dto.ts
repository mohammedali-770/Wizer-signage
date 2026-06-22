import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class InviteSuperAdminDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class ListSuperAdminsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
