import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shapes for the OpenAPI contract.
 *
 * These have to be CLASSES, not the interfaces the services already return.
 * `@nestjs/swagger` builds its schemas from emitted decorator metadata, and a
 * TypeScript interface is erased at compile time — there is nothing left to
 * reflect. That is why `contracts/openapi.json` described 67 request DTOs and
 * ZERO response models: exactly one of 38 controllers declared a response type,
 * so the contract documented what clients send and said nothing about what they
 * get back. Anything generated from it (starting with the dashboard's
 * hand-copied types.ts) would have inherited that hole.
 *
 * They are deliberately declaration-only — no runtime behaviour, no validation.
 * The service return types stay the source of truth for the code; these describe
 * that truth to the contract, and `ApiOkResponse` on the controller is what ties
 * the two together.
 */

/** Pagination envelope carried by every list endpoint. */
export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 137, description: 'Total matching rows, ignoring pagination.' })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

/** `{ success: true }` — the shape returned by endpoints with nothing to say. */
export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

/**
 * A user as the API returns it.
 *
 * Mirrors `UserView` — the Prisma `User` minus `passwordHash`,
 * `twoFactorSecret` and `twoFactorPendingSecret`. Those three are absent on
 * purpose and must stay absent: this class is published documentation, so a
 * field added here is a field the contract promises to return.
 */
export class UserViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'LOCATION_MANAGER', 'CONTENT_MANAGER', 'VIEWER'],
  })
  role!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INVITED', 'LOCKED', 'DISABLED'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'null for a platform-level Super Admin.' })
  companyId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastLoginAt?: string | null;

  @ApiProperty()
  twoFactorEnabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
