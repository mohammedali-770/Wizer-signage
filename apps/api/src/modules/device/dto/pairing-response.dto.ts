import { DeviceStatus, ScreenStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Dashboard-facing pairing responses. The DEVICE-facing routes live on
 * `DeviceController`, which is `@ApiExcludeController()` — the player has its
 * own hand-written client and the golden manifest fixtures in `contracts/`, so
 * those routes are deliberately absent from this document. These three are the
 * dashboard side of the same flow and do belong in it.
 */

/** The device row behind a paired screen. */
export class PairedDeviceDto {
  @ApiProperty()
  deviceId!: string;

  @ApiProperty({ enum: Object.values(DeviceStatus) })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  platform?: string | null;

  @ApiPropertyOptional({ nullable: true })
  modelName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  osVersion?: string | null;

  @ApiPropertyOptional({ nullable: true })
  appVersion?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  pairedAt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSeenAt?: string | null;

  // No token and no token hash. Pairing mints a device credential; it is
  // returned to the DEVICE once, at collection, and never to the dashboard.
}

/** Latest sync/cache snapshot, absent until the device first reports. */
export class PairingSyncDto {
  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  manifestSource?: string | null;

  @ApiPropertyOptional({ nullable: true })
  manifestVersion?: number | null;

  @ApiProperty()
  requiredAssets!: number;

  @ApiProperty()
  cachedAssets!: number;

  @ApiProperty()
  failedDownloads!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  cacheSizeBytes?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Serialised as a string — a 64-bit column, not a JSON number.',
  })
  availableStorageBytes?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncAt?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Device `lastSyncError`, renamed by view.' })
  lastError?: string | null;
}

/**
 * GET /screens/{id}/pairing-status, and what pair/unpair return.
 *
 * All three routes return this same shape: the write endpoints re-read the
 * status rather than reporting what they did, so a client can use one response
 * handler for all of them.
 *
 * `device` and `sync` are both nulled for a REVOKED device — an unpaired screen
 * reports as if it had never been paired, which is what the dashboard shows.
 */
export class PairingStatusDto {
  @ApiProperty()
  screenId!: string;

  @ApiProperty({
    enum: Object.values(ScreenStatus),
    description:
      'The STORED screen status, not the live status monitoring derives from the last ' +
      'heartbeat. The two overlap (ONLINE/OFFLINE/WARNING appear in both) but are computed ' +
      'differently, and this one can be stale.',
  })
  screenStatus!: string;

  @ApiProperty({ description: 'True only for a device row in ACTIVE status.' })
  paired!: boolean;

  @ApiProperty({
    description: 'A code has been claimed but the device has not collected its token yet.',
  })
  pendingCollection!: boolean;

  @ApiPropertyOptional({ type: PairedDeviceDto, nullable: true })
  device?: PairedDeviceDto | null;

  @ApiPropertyOptional({
    type: PairingSyncDto,
    nullable: true,
    description: 'null until the device reports a sync status at least once.',
  })
  sync?: PairingSyncDto | null;
}
