import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FleetVersionDistributionDto {
  @ApiProperty({ description: 'Player appVersion reported by paired screens.', example: '1.4.2' })
  version!: string;

  @ApiProperty({ minimum: 1 })
  count!: number;
}

export class FleetRecentCrashDto {
  @ApiProperty()
  screenId!: string;

  @ApiProperty()
  screenName!: string;

  @ApiProperty({ description: 'Stored screen lifecycle status; crash evidence does not mutate health.' })
  screenStatus!: string;

  @ApiPropertyOptional({ nullable: true })
  appVersion!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastHeartbeatAt!: Date | null;

  @ApiProperty({
    type: Number,
    description: 'Device-reported previous-run crash wall-clock timestamp in epoch milliseconds.',
  })
  crashedAtMillis!: number;

  @ApiProperty({
    pattern: '^[a-f0-9]{24}$',
    description: 'Privacy-bounded crash fingerprint. Raw Android stack traces are never uploaded.',
  })
  fingerprint!: string;

  @ApiProperty({ minimum: 1 })
  crashCount!: number;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  reportedAt!: string | null;
}

export class FleetHealthResponseDto {
  @ApiProperty({ minimum: 0 })
  totalScreens!: number;

  @ApiProperty({ type: [FleetVersionDistributionDto] })
  versionDistribution!: FleetVersionDistributionDto[];

  @ApiProperty({
    type: [FleetRecentCrashDto],
    description: 'At most the 100 most recent valid crash reports for the authenticated company.',
  })
  recentCrashes!: FleetRecentCrashDto[];
}
