import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DemoRequestStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class InviteSuperAdminDto {
  @ApiProperty({
    format: 'email',
    description:
      'Invites a PLATFORM administrator with cross-tenant access, not a company user. 2FA is ' +
      'mandatory for the resulting account and cannot be turned off.',
  })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ maxLength: 120 })
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
  @ApiProperty({
    enum: Object.values(DemoRequestStatus),
    description:
      'The only field — a demo request is a pipeline record, and status is all that moves.',
  })
  @IsIn(Object.values(DemoRequestStatus))
  status!: DemoRequestStatus;
}
