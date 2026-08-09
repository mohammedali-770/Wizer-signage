import { CompanyStatus, SubscriptionStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PlanLimitsViewDto } from '../../usage-limits/dto/usage-response.dto';

/** The read-only billing summary a company admin can see about their own plan. */
export class CompanyPlanSummaryDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ example: 'pro' })
  code!: string;

  @ApiProperty({ enum: Object.values(SubscriptionStatus) })
  status!: string;

  @ApiProperty({ type: PlanLimitsViewDto })
  limits!: PlanLimitsViewDto;
}

export class AndroidOtaSettingsResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  targetVersionCode?: number | null;

  @ApiProperty({ minimum: 0, maximum: 100 })
  rolloutPercent!: number;

  @ApiProperty({ type: [String] })
  screenIds!: string[];

  @ApiProperty({ type: [String] })
  groupIds!: string[];

  @ApiProperty({ minimum: 900, maximum: 86400 })
  checkIntervalSeconds!: number;
}

/**
 * GET /company-settings, and what PATCH/PUT android-ota returns (it re-reads).
 *
 * Assembled from two rows — the Company and its settings JSON — with defaults
 * applied at read time, so several fields are never null even though nothing
 * was ever written: `defaultHeartbeatIntervalSeconds` falls back to 60 and
 * `notificationEmails` to `[]`.
 */
export class CompanySettingsDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: Object.values(CompanyStatus) })
  status!: string;

  @ApiProperty({ example: 'en' })
  defaultLocale!: string;

  @ApiProperty({ description: 'IANA timezone. Schedules resolve in it.', example: 'Asia/Riyadh' })
  timezone!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Per-weekday open/close used as the default for new schedules.',
  })
  defaultWorkingHours?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Defaulted to 60 at read time when unset — never null.' })
  defaultHeartbeatIntervalSeconds!: number;

  @ApiProperty({ type: [String], description: 'Defaulted to [] at read time — never null.' })
  notificationEmails!: string[];

  @ApiPropertyOptional({ nullable: true, description: 'Content played when nothing is scheduled.' })
  fallbackContentId?: string | null;

  @ApiProperty({
    description:
      'Whether a default kiosk PIN is set. The HASH is never returned — same substitution ' +
      'ScreenDto.hasKioskPin makes.',
  })
  hasDefaultKioskPin!: boolean;

  @ApiProperty({
    type: AndroidOtaSettingsResponseDto,
    description: 'Staged Android update policy. Publishing a binary does not modify it.',
  })
  androidOta!: AndroidOtaSettingsResponseDto;

  @ApiPropertyOptional({
    type: CompanyPlanSummaryDto,
    nullable: true,
    description: 'Read-only; a Super Admin manages the subscription. null when there is none.',
  })
  plan?: CompanyPlanSummaryDto | null;
}
