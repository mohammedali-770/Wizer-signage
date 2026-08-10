import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Length } from 'class-validator';

export class FleetVersionDistributionDto {
  @ApiProperty({ example: '1.4.2' })
  version!: string;

  @ApiProperty({ example: 12, minimum: 0 })
  count!: number;
}

export class FleetRecentCrashDto {
  @ApiProperty()
  screenId!: string;

  @ApiProperty()
  screenName!: string;

  @ApiProperty({ example: 'ONLINE' })
  screenStatus!: string;

  @ApiPropertyOptional({ nullable: true, example: '1.4.2' })
  appVersion!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastHeartbeatAt!: Date | null;

  @ApiProperty({ example: 1786260000000 })
  crashedAtMillis!: number;

  @ApiProperty({ example: 'a1b2c3d4e5f60718293a4b5c', minLength: 24, maxLength: 24 })
  @Length(24, 24)
  fingerprint!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  crashCount!: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  reportedAt!: string | null;
}

export class FleetHealthSummaryDto {
  @ApiProperty({ minimum: 0 })
  totalScreens!: number;

  @ApiProperty({ type: [FleetVersionDistributionDto] })
  versionDistribution!: FleetVersionDistributionDto[];

  @ApiProperty({ type: [FleetRecentCrashDto], maxItems: 100 })
  recentCrashes!: FleetRecentCrashDto[];
}
