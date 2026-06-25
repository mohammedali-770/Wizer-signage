import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DemoRequestStatus } from '@prisma/client';

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

export class ListDemoRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(Object.values(DemoRequestStatus))
  status?: DemoRequestStatus;
}

export class UpdateDemoRequestDto {
  @IsIn(Object.values(DemoRequestStatus))
  status!: DemoRequestStatus;
}
