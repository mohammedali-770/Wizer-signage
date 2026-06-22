/** Default heartbeat cadence the device should use. */
export const HEARTBEAT_INTERVAL_SECONDS = 60;
/** Default command-poll cadence (polling delivery; WebSocket is a future option). */
export const COMMAND_POLL_INTERVAL_SECONDS = 12;
/** A screen is OFFLINE after this many missed heartbeats. */
export const OFFLINE_MISSED_HEARTBEATS = 3;
/** A pending command expires (un-collected) after this long. */
export const COMMAND_TTL_SECONDS = 5 * 60;
/** Automatic screenshots default off (avoid storage abuse). */
export const AUTO_SCREENSHOT_DEFAULT_ENABLED = false;
export const AUTO_SCREENSHOT_DEFAULT_INTERVAL_MINUTES = 10;

export type LiveScreenStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'WARNING'
  | 'UNPAIRED'
  | 'PAIRING'
  | 'DISABLED'
  | 'ARCHIVED';

export interface StatusInput {
  storedStatus: string;
  lastHeartbeatAt: Date | null;
  heartbeatIntervalSeconds: number | null;
  syncStatus?: string | null;
  lastError?: string | null;
  playbackState?: string | null;
  now?: number;
}

/**
 * Derive a screen's live status from its last heartbeat (pure — unit-tested).
 * Manual/lifecycle states (DISABLED/ARCHIVED/UNPAIRED/PAIRING) are authoritative
 * and never overwritten. A paired screen with no recent heartbeat is OFFLINE; a
 * fresh heartbeat reporting an error/failed/partial sync is WARNING; otherwise
 * ONLINE.
 */
export function deriveScreenStatus(input: StatusInput): {
  status: LiveScreenStatus;
  warningReason: string | null;
} {
  const { storedStatus } = input;
  if (
    storedStatus === 'DISABLED' ||
    storedStatus === 'ARCHIVED' ||
    storedStatus === 'UNPAIRED' ||
    storedStatus === 'PAIRING'
  ) {
    return { status: storedStatus as LiveScreenStatus, warningReason: null };
  }
  const now = input.now ?? Date.now();
  if (!input.lastHeartbeatAt) return { status: 'OFFLINE', warningReason: null };

  const interval =
    input.heartbeatIntervalSeconds && input.heartbeatIntervalSeconds > 0
      ? input.heartbeatIntervalSeconds
      : HEARTBEAT_INTERVAL_SECONDS;
  const thresholdMs = interval * OFFLINE_MISSED_HEARTBEATS * 1000;
  if (now - input.lastHeartbeatAt.getTime() > thresholdMs) {
    return { status: 'OFFLINE', warningReason: null };
  }

  if (input.playbackState === 'ERROR')
    return { status: 'WARNING', warningReason: 'Player reported an error.' };
  if (input.syncStatus === 'FAILED') return { status: 'WARNING', warningReason: 'Sync failed.' };
  if (input.syncStatus === 'PARTIAL')
    return { status: 'WARNING', warningReason: 'Some assets failed to download.' };
  if (input.lastError) return { status: 'WARNING', warningReason: input.lastError };
  return { status: 'ONLINE', warningReason: null };
}
