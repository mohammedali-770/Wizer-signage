import { ContentType, Orientation } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The playback manifest — what a screen should be showing right now.
 *
 * This is the ONE response shape in the contract that already has an
 * independent guard: `contracts/device-manifest.*.golden.json` are parsed by
 * both the API's `device-manifest.contract.spec.ts` and the player's
 * `ManifestContractTest`, so a renamed field fails the Kotlin build rather than
 * blanking a fleet quietly. This class documents that same shape for HTTP
 * clients; the golden files remain the source of truth for the wire format, and
 * the two must be changed together.
 *
 * Note the device-facing route that serves it (`GET /device/manifest`) is on
 * `@ApiExcludeController()` — the player has a hand-written client. The route
 * documented here is the DASHBOARD's preview of the same resolution.
 */

/** One item in the resolved playlist. */
export class ManifestItemDto {
  @ApiProperty({
    description:
      'Library content id, or a synthetic `emg:` id for a direct TEXT/URL emergency item that ' +
      'no Content row backs. The player keys on the prefix and reports proof-of-play with a ' +
      'null contentId for those, because there is no FK to satisfy.',
  })
  contentId!: string;

  @ApiProperty({ enum: Object.values(ContentType) })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  durationSeconds!: number;

  @ApiProperty({ description: 'Play the whole video rather than cutting at durationSeconds.' })
  playFullVideo!: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Per-page dwell for PDFs; null otherwise.' })
  pdfPageDurationSeconds?: number | null;

  @ApiProperty({ enum: Object.values(Orientation) })
  orientation!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  fileSizeBytes?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'For cache validation after download.' })
  checksum?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mimeType?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Short-lived signed URL for ONLINE playback of a stored file; null for URL/TEXT items. ' +
      'Excluded from manifestHash, because it rotates on every read.',
  })
  signedUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Device-authenticated path for OFFLINE caching, relative to /api — e.g. ' +
      '`/device/content/{id}/download`. null for URL/TEXT.',
  })
  downloadPath?: string | null;

  @ApiProperty({
    description: "Content version marker (the row's updatedAt) so a cache can detect changes.",
  })
  version!: string;

  @ApiPropertyOptional({ nullable: true, description: 'External URL for URL content.' })
  url?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Body for TEXT content.' })
  textBody?: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;
}

/** GET /screens/{id}/playback-manifest. */
export class PlaybackManifestDto {
  @ApiProperty()
  screenId!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Excluded from manifestHash — it always changes.',
  })
  generatedAt!: string;

  @ApiProperty({
    description:
      'SHA-256 of WHAT plays — items, schedule/playlist/emergency identity, priority, message — ' +
      'and deliberately NOT of generatedAt or the rotating signed URLs. So it changes only when ' +
      'the effective configuration changes, which is what makes "out of date" cheap to detect. ' +
      'The player reports this back as its synced manifest version.',
  })
  manifestHash!: string;

  @ApiProperty({ description: "The screen's IANA timezone, which the resolution was made in." })
  timezone!: string;

  @ApiProperty({
    enum: ['SCHEDULE', 'FALLBACK', 'EMERGENCY', 'NONE'],
    description: 'Why these items were chosen. NONE means nothing applies and items is empty.',
  })
  sourceType!: string;

  @ApiPropertyOptional({ nullable: true })
  scheduleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  scheduleName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playlistId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  playlistTitle?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Set only when sourceType is EMERGENCY.' })
  emergencyBroadcastId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  priority?: number | null;

  @ApiProperty({ description: 'True when the resolution time falls outside the schedule window.' })
  outsideHours!: boolean;

  @ApiPropertyOptional({ nullable: true })
  outsideHoursBehavior?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Emergency message text, when present.' })
  message?: string | null;

  @ApiProperty({ type: [ManifestItemDto], description: 'Empty when sourceType is NONE.' })
  items!: ManifestItemDto[];

  @ApiProperty({ type: [String] })
  warnings!: string[];
}
