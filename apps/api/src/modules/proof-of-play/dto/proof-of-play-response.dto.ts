import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Proof-of-play reporting shapes.
 *
 * The view LABELS every foreign key — `contentTitle` beside `contentId`,
 * `screenName` beside `screenId`, and so on — resolved from maps built in the
 * service. Each label is nullable independently of its id: a play whose content
 * has since been deleted keeps the id and loses the title. A client must not
 * assume a non-null id implies a non-null label.
 */
export class ProofOfPlayRecordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  endedAt?: string | null;

  @ApiProperty()
  screenId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'null if the screen row is gone.' })
  screenName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  locationName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'null for a synthetic `emg:` emergency item — there is no Content row to reference.',
  })
  contentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  contentTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  contentType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playlistId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playlistTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  scheduleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  scheduleName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  emergencyBroadcastId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  emergencyBroadcastTitle?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why it played: SCHEDULE/FALLBACK/EMERGENCY.',
  })
  sourceType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playbackSource?: string | null;

  @ApiProperty({ enum: ['STARTED', 'COMPLETED', 'FAILED', 'SKIPPED', 'INTERRUPTED'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'How long it actually played.' })
  durationMs?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'How long it was supposed to play.' })
  expectedDurationMs?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Played from cache with no network.' })
  offlinePlayback?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  manifestVersion?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Position within the playlist for this play.',
  })
  itemSequence?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Groups the plays of one playlist pass.' })
  playbackSessionId?: string | null;
}

/** A row of the "most played" table. */
export class TopContentDto {
  @ApiPropertyOptional({ nullable: true })
  contentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  title?: string | null;

  @ApiProperty()
  plays!: number;
}

/** A screen with failed plays in the window. */
export class FailingScreenDto {
  @ApiProperty()
  screenId!: string;

  @ApiPropertyOptional({ nullable: true })
  name?: string | null;

  @ApiProperty()
  failures!: number;
}

/** GET /proof-of-play/summary. */
export class ProofOfPlaySummaryDto {
  @ApiProperty({ description: 'Every event in the window, whatever its status.' })
  totalPlays!: number;

  @ApiProperty()
  completedPlays!: number;

  @ApiProperty()
  failedPlays!: number;

  @ApiProperty()
  skippedPlays!: number;

  @ApiProperty()
  interruptedPlays!: number;

  @ApiProperty({
    description: 'Started and not yet resolved — these are still counted in totalPlays.',
  })
  startedPlays!: number;

  @ApiProperty({ description: 'Summed actual playback time. 0 when nothing reported a duration.' })
  totalDurationMs!: number;

  @ApiProperty({ type: [TopContentDto] })
  mostPlayedContent!: TopContentDto[];

  @ApiProperty({ type: [FailingScreenDto] })
  screensWithFailures!: FailingScreenDto[];
}
