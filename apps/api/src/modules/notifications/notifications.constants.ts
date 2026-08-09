import { NotificationSeverity } from '@prisma/client';

/**
 * Catalog of operational alert/notification event types (Phase 10). Stable
 * string ids stored on Alert.type / Notification.type and used as the eventType
 * key for NotificationPreference.
 */
export const AlertEvent = {
  ScreenOffline: 'screen.offline',
  ScreenOnline: 'screen.online',
  ScreenWarning: 'screen.warning',
  SyncFailed: 'sync.failed',
  ScreenshotFailed: 'screenshot.failed',
  CommandFailed: 'command.failed',
  StorageNearLimit: 'storage.near_limit',
  StorageExceeded: 'storage.exceeded',
  PlanLimitExceeded: 'plan.limit_exceeded',
  GraceStarted: 'grace.started',
  GraceEnding: 'grace.ending',
  SubscriptionExpiring: 'subscription.expiring',
  SubscriptionExpired: 'subscription.expired',
  EmergencyActivated: 'emergency.activated',
  EmergencyEnded: 'emergency.ended',
  BackupFailed: 'backup.failed',
  ReportFailed: 'report.failed',
  ContentExpiring: 'content.expiring',
  AndroidOtaAutoRollback: 'android.ota.auto_rollback',
} as const;

export type AlertEventType = (typeof AlertEvent)[keyof typeof AlertEvent];

/** Default severity per event (callers may override). */
export const DEFAULT_SEVERITY: Record<string, NotificationSeverity> = {
  [AlertEvent.ScreenOffline]: NotificationSeverity.CRITICAL,
  [AlertEvent.ScreenOnline]: NotificationSeverity.INFO,
  [AlertEvent.ScreenWarning]: NotificationSeverity.WARNING,
  [AlertEvent.SyncFailed]: NotificationSeverity.WARNING,
  [AlertEvent.ScreenshotFailed]: NotificationSeverity.WARNING,
  [AlertEvent.CommandFailed]: NotificationSeverity.WARNING,
  [AlertEvent.StorageNearLimit]: NotificationSeverity.WARNING,
  [AlertEvent.StorageExceeded]: NotificationSeverity.CRITICAL,
  [AlertEvent.PlanLimitExceeded]: NotificationSeverity.CRITICAL,
  [AlertEvent.GraceStarted]: NotificationSeverity.WARNING,
  [AlertEvent.GraceEnding]: NotificationSeverity.WARNING,
  [AlertEvent.SubscriptionExpiring]: NotificationSeverity.WARNING,
  [AlertEvent.SubscriptionExpired]: NotificationSeverity.CRITICAL,
  [AlertEvent.EmergencyActivated]: NotificationSeverity.CRITICAL,
  [AlertEvent.EmergencyEnded]: NotificationSeverity.INFO,
  [AlertEvent.BackupFailed]: NotificationSeverity.CRITICAL,
  [AlertEvent.ReportFailed]: NotificationSeverity.WARNING,
  [AlertEvent.ContentExpiring]: NotificationSeverity.INFO,
  [AlertEvent.AndroidOtaAutoRollback]: NotificationSeverity.CRITICAL,
};

/**
 * Events that default to ALSO emailing (the spec's "email alerts to include"
 * list). Every event defaults to a dashboard notification; only this curated
 * set emails by default to avoid noise. A user's NotificationPreference can
 * override either way.
 */
export const EMAIL_DEFAULT_EVENTS: ReadonlySet<string> = new Set<string>([
  AlertEvent.ScreenOffline,
  AlertEvent.ScreenOnline,
  AlertEvent.EmergencyActivated,
  AlertEvent.EmergencyEnded,
  AlertEvent.SubscriptionExpiring,
  AlertEvent.SubscriptionExpired,
  AlertEvent.GraceStarted,
  AlertEvent.GraceEnding,
  AlertEvent.BackupFailed,
  AlertEvent.ReportFailed,
  AlertEvent.AndroidOtaAutoRollback,
]);

/** Default on/off for a (channel, event) pair when the user has no preference row. */
export function defaultChannelEnabled(channel: 'DASHBOARD' | 'EMAIL', eventType: string): boolean {
  if (channel === 'DASHBOARD') return true;
  return EMAIL_DEFAULT_EVENTS.has(eventType);
}

/** Notification.channels uses these string tags (matches existing schema usage). */
export const CHANNEL_IN_APP = 'in_app';
export const CHANNEL_EMAIL = 'email';
