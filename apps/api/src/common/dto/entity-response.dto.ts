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

/** A tag or group as it appears nested inside another resource. */
export class NestedRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

/**
 * A screen as the API returns it.
 *
 * Written from `ScreensService.toView`, NOT from the Prisma model — the two
 * differ in exactly the way that matters. The model carries `kioskPinHash`;
 * the view strips it and substitutes `hasKioskPin`. A DTO generated from the
 * schema would publish a password-hash field as a documented part of the API,
 * and the name sits close enough to the other 32 to survive a skim.
 */
export class ScreenDto extends TenantOwnedDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationId?: string | null;

  @ApiPropertyOptional({ type: NestedRefDto, nullable: true })
  location?: NestedRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Hardware id reported by the paired player; null until pairing.',
  })
  deviceIdentifier?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pairedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastHeartbeatAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  appVersion?: string | null;

  @ApiProperty()
  audioEnabled!: boolean;

  @ApiProperty({ minimum: 0, maximum: 100 })
  volume!: number;

  @ApiProperty()
  muted!: boolean;

  @ApiPropertyOptional({ nullable: true })
  muteSchedule?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  workingHours?: Record<string, unknown> | null;

  @ApiProperty()
  kioskEnabled!: boolean;

  @ApiProperty({
    description:
      'Whether an exit PIN is set. The PIN itself is stored hashed and is never returned — ' +
      'this boolean replaces it.',
  })
  hasKioskPin!: boolean;

  @ApiProperty()
  autoStartEnabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  powerControlMode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fallbackContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentContentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentPlaylistId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Bytes, as a STRING. The column is a 64-bit integer and would lose precision as a JSON ' +
      'number, so PrismaService serialises BigInt via toJSON.',
  })
  storageUsedBytes?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Bytes, as a string.' })
  storageTotalBytes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  capabilities?: Record<string, unknown> | null;

  @ApiProperty()
  heartbeatIntervalSeconds!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  latitude?: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  longitude?: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes?: string | null;

  @ApiProperty({ type: [TagDto] })
  tags!: TagDto[];

  @ApiProperty({ type: [NestedRefDto] })
  groups!: NestedRefDto[];
}
