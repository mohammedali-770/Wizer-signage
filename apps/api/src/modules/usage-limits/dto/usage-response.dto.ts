import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `UsageEvaluation` as the API returns it — GET /companies/{id}/usage.
 *
 * Transcribed from the `UsageEvaluation` interface in `usage-limits.service.ts`
 * rather than from a view: the service returns the evaluation object whole.
 * That means every field the interface gains appears in the response, so this
 * class is the only record of what the endpoint is supposed to send.
 */

const USAGE_STATUS = ['ok', 'approaching', 'exceeded', 'grace', 'blocked'] as const;

/** Raw counts behind the evaluation. */
export class UsageCountsDto {
  @ApiProperty()
  locations!: number;

  @ApiProperty()
  screens!: number;

  @ApiProperty()
  users!: number;

  @ApiProperty({
    description:
      'Non-expired PENDING invitations. Counted because each one RESERVES a user seat — a ' +
      'company at its user limit with outstanding invitations is already full.',
  })
  pendingInvitations!: number;

  @ApiProperty({
    description:
      'A string, matching the per-row `fileSize` it sums — that field is a 64-bit column and ' +
      'has always serialised as a string. This aggregate used to go through Number(), making ' +
      'the same quantity two types depending on which endpoint you asked.',
    example: '10737418240',
  })
  storageBytes!: string;

  @ApiProperty()
  storageGb!: number;
}

/**
 * The plan's raw limit block.
 *
 * Every field is optional AND nullable, and both spellings mean the same thing:
 * absent or null is UNLIMITED, not zero. Note that only four of these eleven
 * have a matching `ResourceUsageDto` — the rest are enforced elsewhere or not
 * yet enforced at all, so a client must not infer that a limit here is being
 * measured.
 */
export class PlanLimitsViewDto {
  @ApiPropertyOptional({ nullable: true })
  maxCompanies?: number | null;

  @ApiPropertyOptional({ nullable: true })
  maxLocations?: number | null;

  @ApiPropertyOptional({ nullable: true })
  maxScreens?: number | null;

  @ApiPropertyOptional({ nullable: true })
  maxUsers?: number | null;

  @ApiPropertyOptional({ nullable: true })
  storageGb?: number | null;

  @ApiPropertyOptional({ nullable: true })
  maxFileSizeMb?: number | null;

  @ApiPropertyOptional({ nullable: true })
  autoScreenshotsPerDay?: number | null;

  @ApiPropertyOptional({ nullable: true })
  scheduledReports?: number | null;

  @ApiPropertyOptional({ nullable: true })
  dataRetentionDays?: number | null;

  @ApiPropertyOptional({ nullable: true })
  apiRequestsPerDay?: number | null;

  @ApiPropertyOptional({ nullable: true })
  webhooks?: number | null;
}

/** One metered resource, measured against the plan. */
export class ResourceUsageDto {
  @ApiProperty({ enum: ['locations', 'screens', 'users', 'storageGb'] })
  key!: string;

  @ApiProperty()
  used!: number;

  @ApiPropertyOptional({ nullable: true, description: 'null means unlimited on this plan.' })
  limit?: number | null;

  @ApiProperty()
  unlimited!: boolean;

  @ApiProperty()
  exceeded!: boolean;

  @ApiProperty({ description: 'At or above 80% of the limit, and not yet exceeded.' })
  approaching!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null when unlimited, or when the limit is zero.',
  })
  percentUsed?: number | null;
}

/** GET /companies/{id}/usage. */
export class UsageEvaluationDto {
  @ApiProperty({ type: UsageCountsDto })
  usage!: UsageCountsDto;

  @ApiProperty({ type: [ResourceUsageDto] })
  resources!: ResourceUsageDto[];

  @ApiProperty({
    enum: USAGE_STATUS,
    description:
      'Worst status across every metered resource. `grace` and `blocked` are both over-limit ' +
      'states — the difference is whether the grace window has run out.',
  })
  status!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  gracePeriodEndsAt?: string | null;

  @ApiProperty()
  inGrace!: boolean;

  @ApiProperty({ description: 'A grace window existed and has passed.' })
  graceExpired!: boolean;

  @ApiPropertyOptional({ nullable: true })
  planCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  planName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Copied through as a plain string, not the SubscriptionStatus enum.',
  })
  subscriptionStatus?: string | null;

  // Nearly missed: `UsageEvaluation` carries the raw limit block too, and the
  // service returns the object WHOLE. Transcribing an interface has the same
  // hazard as transcribing a spread view — a field added to the interface is a
  // field the endpoint starts returning, silently.
  @ApiProperty({ type: PlanLimitsViewDto })
  limits!: PlanLimitsViewDto;
}
