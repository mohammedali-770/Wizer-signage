import { AlertStatus, NotificationChannel, NotificationSeverity } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Dashboard → backend: list alerts with filters. */
export class ListAlertsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @IsOptional()
  @IsEnum(NotificationSeverity)
  severity?: NotificationSeverity;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  screenId?: string;

  /** Super Admin only: drill into a specific company's alerts (else system alerts). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  companyId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  unreadOnly?: boolean;
}

/** A single notification preference entry. */
export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: Object.values(NotificationChannel) })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty({
    description:
      'A free-form event key, NOT an enum — any string up to 80 characters is accepted, ' +
      'including one that matches no event the platform emits. Such a row is stored and simply ' +
      'never consulted, so a typo here fails silently rather than as a 400.',
    maxLength: 80,
    example: 'screen.offline',
  })
  @IsString()
  @MaxLength(80)
  eventType!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

/**
 * Upserts the entries it names and leaves the rest alone.
 *
 * Despite "Replace" in the name this is NOT a full replacement of the caller's
 * preferences: an event type absent from the array keeps whatever it had. To
 * turn something off you must send it with `enabled: false` — omitting it does
 * nothing.
 */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: [NotificationPreferenceItemDto],
    maxItems: 200,
    description: "Entries to upsert. Only the caller's own preferences can be changed.",
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences!: NotificationPreferenceItemDto[];
}
