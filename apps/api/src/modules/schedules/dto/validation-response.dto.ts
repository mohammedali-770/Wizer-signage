import { ScheduleType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The `validate` and `conflicts` responses for schedules, playlists and
 * emergency broadcasts.
 *
 * Three endpoints called `validate`, and they agree on almost nothing:
 *
 *   GET /schedules/{id}/validate  -> { id, schedulable, playlist, targetCount,
 *                                      orientationWarnings, conflicts, warnings }
 *   GET /playlists/{id}/validate  -> { id, valid, schedulable, itemCount, ...,
 *                                      issues, warnings }
 *   GET /emergency-broadcasts/{id}/validate
 *                                 -> { valid, canActivate, errors, warnings,
 *                                      affectedScreens }
 *
 * The only field all three share is `warnings`. Two have `valid`, and only one
 * of THOSE also has `schedulable` — where playlists set both to the same value,
 * so `valid` there is an alias, not a second opinion. One has `errors`; the
 * others express failure as an empty-ish result plus warnings. Only emergency
 * has `canActivate`.
 *
 * A single shared `ValidationResultDto` is the obvious tidy-up and would be
 * wrong for all three. They are documented separately, and named for the thing
 * they validate, so a client cannot write one handler and assume it fits.
 */

/** Another schedule that overlaps this one on at least one screen. */
export class ScheduleConflictDto {
  @ApiProperty()
  scheduleId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    type: [String],
    description: 'The screens both schedules target. Never empty — that is what makes it a clash.',
  })
  sharedScreenIds!: string[];

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Which of the two the resolver would play, by priority then type. null when the rules ' +
      'cannot separate them, which is the case a human has to settle.',
  })
  winnerId?: string | null;
}

/** The playlist attached to a schedule, and whether it can actually play. */
export class SchedulePlaylistValidityDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schedulable!: boolean;

  @ApiProperty({ description: 'Items that would actually play. Zero means nothing would.' })
  validItemCount!: number;
}

/** GET /schedules/{id}/validate. */
export class ScheduleValidationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'Whether this schedule would actually put something on screen. Note there is no `valid` ' +
      'here — the playlist endpoint has both, this one only has `schedulable`.',
  })
  schedulable!: boolean;

  @ApiPropertyOptional({
    type: SchedulePlaylistValidityDto,
    nullable: true,
    description: 'null when the schedule has no playlist attached.',
  })
  playlist?: SchedulePlaylistValidityDto | null;

  @ApiProperty({ description: 'How many screens/groups/locations the schedule targets.' })
  targetCount!: number;

  @ApiProperty({
    type: [String],
    description: 'Content whose orientation does not match the screens it would play on.',
  })
  orientationWarnings!: string[];

  @ApiProperty({ type: [ScheduleConflictDto] })
  conflicts!: ScheduleConflictDto[];

  @ApiProperty({
    type: [String],
    description:
      'Timing warnings PLUS every orientationWarning — the orientation ones appear twice, once ' +
      'in their own field and again here. Concatenating the two lists double-counts them.',
  })
  warnings!: string[];
}

/** One side of an overlapping pair. */
export class ConflictScheduleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Higher wins.' })
  priority!: number;

  @ApiProperty({ enum: Object.values(ScheduleType) })
  scheduleType!: string;
}

/** A pair of ACTIVE schedules that overlap on at least one screen. */
export class SchedulePairConflictDto {
  @ApiProperty({ type: ConflictScheduleSummaryDto })
  a!: ConflictScheduleSummaryDto;

  @ApiProperty({ type: ConflictScheduleSummaryDto })
  b!: ConflictScheduleSummaryDto;

  @ApiProperty({ type: [String] })
  sharedScreenIds!: string[];

  @ApiPropertyOptional({ nullable: true, description: 'null when priority and type tie.' })
  winnerId?: string | null;
}

/**
 * GET /schedules/conflicts.
 *
 * A one-key object rather than a bare array. Documenting it as an array is the
 * easy mistake — the field name and the endpoint name are both "conflicts".
 */
export class ScheduleConflictsDto {
  @ApiProperty({ type: [SchedulePairConflictDto], description: 'Every overlapping ACTIVE pair.' })
  conflicts!: SchedulePairConflictDto[];
}

/** An item that would not play, and why. */
export class PlaylistItemIssueDto {
  @ApiProperty()
  itemId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'null if the content row is gone.' })
  contentTitle?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Expired, archived, trashed or deleted content.',
  })
  issue?: string | null;
}

/** GET /playlists/{id}/validate. */
export class PlaylistValidationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'An ALIAS of `schedulable` — the service assigns both from the same value. Two names for ' +
      'one field, kept because clients read each of them.',
  })
  valid!: boolean;

  @ApiProperty({ description: 'The same boolean as `valid`.' })
  schedulable!: boolean;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  validItemCount!: number;

  @ApiProperty()
  invalidItemCount!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The orientation every item shares, or null when they disagree.',
  })
  orientationProfile?: string | null;

  @ApiProperty()
  totalDurationSeconds!: number;

  @ApiProperty({ type: [PlaylistItemIssueDto], description: 'One entry per INVALID item only.' })
  issues!: PlaylistItemIssueDto[];

  @ApiProperty({ type: [String] })
  warnings!: string[];
}

/** GET /emergency-broadcasts/{id}/validate. */
export class EmergencyValidationDto {
  @ApiProperty({
    description:
      'No errors AND at least one affected screen. An override reaching nobody is not valid.',
  })
  valid!: boolean;

  @ApiProperty({
    description:
      '`valid` AND the broadcast is not already ENDED or ARCHIVED. The two differ for a finished ' +
      'broadcast: still well-formed, no longer activatable.',
  })
  canActivate!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Hard failures. The only one of the three validate endpoints that has these.',
  })
  errors!: string[];

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({
    description: 'A COUNT, not the ids — the service returns `affectedScreenIds.length`.',
  })
  affectedScreens!: number;
}
