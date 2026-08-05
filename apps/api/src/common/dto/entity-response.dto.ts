import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Entity response shapes for the OpenAPI contract.
 *
 * Same rule as `api-response.dto.ts`: these must be CLASSES, because
 * `@nestjs/swagger` reflects decorator metadata and a TypeScript interface is
 * erased at compile time. They are declaration-only — the services' return types
 * remain the source of truth for the code; these describe that truth to clients.
 *
 * A field listed here is a field the contract PROMISES the API returns. Adding
 * one is a published commitment, and — as `Screen.kioskPinHash` shows — leaving
 * one out can be the whole point.
 */

class TenantOwnedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Owning tenant. Derived from the caller's token, never the body." })
  companyId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TagDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: '#2F80ED' })
  color?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({
    enum: ['CONTENT', 'SCREEN', 'BOTH'],
    description: 'Which resources the tag may be applied to.',
  })
  type?: string;
}

export class ScreenGroupDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  category?: string | null;

  @ApiPropertyOptional({ description: 'Members, when the endpoint includes them.' })
  screenCount?: number;
}

export class LocationDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Tenant-unique short code.' })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  region?: string | null;

  @ApiPropertyOptional({ nullable: true })
  country?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  longitude?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Asia/Riyadh',
    description:
      'IANA zone. Schedules resolve against it, so a bare city name runs them hours off.',
  })
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opening hours per weekday; screens outside them follow the outside-hours policy.',
  })
  workingHours?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  fallbackContentId?: string | null;

  @ApiPropertyOptional({ description: 'Screens at this location, when the endpoint includes it.' })
  screenCount?: number;
}
