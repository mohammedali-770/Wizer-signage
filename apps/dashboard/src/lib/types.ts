/** API response shapes used by the Super Admin dashboard (Phase 2). */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'COMPANY_ADMIN'
  | 'LOCATION_MANAGER'
  | 'CONTENT_MANAGER'
  | 'VIEWER';

export type CompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING' | 'CANCELLED';
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';
export type InvoiceStatus = 'DRAFT' | 'UNPAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type UserStatus = 'ACTIVE' | 'INVITED' | 'DISABLED' | 'LOCKED';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  companyId: string | null;
}
export interface MeResponse {
  user: AuthUser;
  permissions: string[];
  mfaSatisfied: boolean;
  twoFactorRequired: boolean;
}

export interface PlanLimits {
  maxCompanies?: number | null;
  maxLocations?: number | null;
  maxScreens?: number | null;
  maxUsers?: number | null;
  storageGb?: number | null;
  maxFileSizeMb?: number | null;
  autoScreenshotsPerDay?: number | null;
  scheduledReports?: number | null;
  dataRetentionDays?: number | null;
  apiRequestsPerDay?: number | null;
  webhooks?: number | null;
}

export interface Plan {
  id: string;
  name: string;
  code: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string | null;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  limits: PlanLimits;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMetrics {
  users: number;
  locations: number;
  screens: number;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  defaultLocale: string;
  timezone: string;
  logoUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
  brandedEmailFrom: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyListItem extends Company {
  metrics: CompanyMetrics;
  subscription: (Subscription & { plan: Pick<Plan, 'name' | 'code'> }) | null;
}

export interface Subscription {
  id: string;
  companyId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  plan?: Plan;
  company?: Pick<Company, 'id' | 'name' | 'slug' | 'status'>;
}

export interface ResourceUsage {
  key: 'locations' | 'screens' | 'users' | 'storageGb';
  used: number;
  limit: number | null;
  unlimited: boolean;
  exceeded: boolean;
  approaching: boolean;
  percentUsed: number | null;
}
export interface UsageEvaluation {
  usage: {
    locations: number;
    screens: number;
    users: number;
    storageBytes: number;
    storageGb: number;
  };
  resources: ResourceUsage[];
  status: 'ok' | 'approaching' | 'exceeded' | 'grace' | 'blocked';
  gracePeriodEndsAt: string | null;
  inGrace: boolean;
  graceExpired: boolean;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  limits: PlanLimits;
}

export interface CompanyDetail {
  company: Company;
  subscription: (Subscription & { plan: Plan }) | null;
  usage: UsageEvaluation;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}
export interface Invoice {
  id: string;
  number: string;
  companyId: string;
  subscriptionId: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: string;
  tax: string | null;
  total: string;
  lineItems: InvoiceLineItem[];
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  company?: Pick<Company, 'id' | 'name' | 'slug'>;
}

export interface SuperAdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  companyId: string | null;
  actorId: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

// --- Phase 3: Company management ------------------------------------------

export type ScreenStatus =
  | 'UNPAIRED'
  | 'PAIRING'
  | 'ONLINE'
  | 'OFFLINE'
  | 'WARNING'
  | 'DISABLED'
  | 'ARCHIVED';
export type LocationStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ScreenUse =
  | 'MENU_LANDSCAPE'
  | 'OFFERS_PORTRAIT'
  | 'WAITING_AREA'
  | 'CASHIER_DISPLAY'
  | 'ENTRANCE'
  | 'INDOOR'
  | 'OUTDOOR'
  | 'GENERIC';
export type Orientation = 'LANDSCAPE' | 'PORTRAIT' | 'UNKNOWN';
export type TagType = 'SCREEN' | 'CONTENT' | 'BOTH';
export type OutsideHoursBehavior = 'FALLBACK' | 'BLACK_SCREEN' | 'CUSTOM_MESSAGE' | 'SLEEP';

export interface DayHours {
  day: number;
  closed: boolean;
  open?: string;
  close?: string;
}
export interface WorkingHours {
  timezone?: string;
  days?: DayHours[];
  outsideHoursBehavior?: OutsideHoursBehavior;
  outsideHoursMessage?: string;
}

export interface ScreenMetrics {
  total: number;
  online: number;
  offline: number;
  warning: number;
  other: number;
}

export interface Location {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  notes: string | null;
  status: LocationStatus;
  workingHours: WorkingHours | null;
  fallbackContentId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LocationListItem extends Location {
  screenCount: number;
}
export interface LocationDetail extends Location {
  metrics: ScreenMetrics;
}

export interface TagLite {
  id: string;
  name: string;
  color: string | null;
  type: TagType;
}
export interface GroupLite {
  id: string;
  name: string;
}

export interface Screen {
  id: string;
  companyId: string;
  locationId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  use: ScreenUse | null;
  orientation: Orientation;
  status: ScreenStatus;
  audioEnabled: boolean;
  volume: number;
  muted: boolean;
  muteSchedule: Record<string, unknown> | null;
  workingHours: WorkingHours | null;
  kioskEnabled: boolean;
  hasKioskPin: boolean;
  autoStartEnabled: boolean;
  powerControlMode: string | null;
  heartbeatIntervalSeconds: number;
  fallbackContentId: string | null;
  appVersion: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  currentContentId: string | null;
  storageUsedBytes: string | null;
  storageTotalBytes: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  location: GroupLite | null;
  tags: TagLite[];
  groups: GroupLite[];
}

export interface Tag {
  id: string;
  companyId: string;
  name: string;
  type: TagType;
  color: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  screenCount?: number;
}

export interface ScreenGroup {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  screenCount?: number;
}
export interface ScreenGroupDetail extends ScreenGroup {
  screens: { id: string; name: string; status: ScreenStatus; locationId: string | null }[];
}

// --- Phase 4: Content library ---------------------------------------------

export type ContentType = 'IMAGE' | 'VIDEO' | 'PDF' | 'URL' | 'TEXT';
export type ContentStatus = 'ACTIVE' | 'ARCHIVED' | 'TRASH' | 'DELETED';

export interface Content {
  id: string;
  companyId: string;
  type: ContentType;
  title: string;
  description: string | null;
  url: string | null;
  fileSize: string | null;
  mimeType: string | null;
  originalFileName: string | null;
  pageCount: number | null;
  textBody: string | null;
  textStyle: Record<string, unknown> | null;
  orientation: Orientation;
  durationSeconds: number | null;
  status: ContentStatus;
  expiresAt: string | null;
  archivedAt: string | null;
  trashedAt: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  tags: TagLite[];
  isExpired: boolean;
}

export interface ContentPreviewData {
  type: ContentType;
  url?: string;
  textBody?: string | null;
  textStyle?: Record<string, unknown> | null;
  mimeType?: string | null;
}

export interface ContentUsage {
  storage: {
    usedBytes: number;
    usedGb: number;
    limitGb: number | null;
    unlimited: boolean;
    percentUsed: number | null;
    status: 'ok' | 'approaching' | 'exceeded' | 'grace' | 'blocked';
    inGrace: boolean;
    gracePeriodEndsAt: string | null;
  };
  counts: {
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
}

export interface CompanySettings {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  defaultLocale: string;
  timezone: string;
  defaultWorkingHours: WorkingHours | null;
  defaultHeartbeatIntervalSeconds: number;
  notificationEmails: string[];
  fallbackContentId: string | null;
  hasDefaultKioskPin: boolean;
  plan: { name: string; code: string; status: SubscriptionStatus; limits: PlanLimits } | null;
}

export interface Overview {
  companies: { total: number; byStatus: Record<CompanyStatus, number> };
  subscriptions: { total: number; byStatus: Record<SubscriptionStatus, number> };
  plans: { active: number };
  invoices: { unpaid: number; unpaidTotal: number };
  users: { total: number };
  superAdmins: { active: number };
}

// --- Phase 6: Device pairing ----------------------------------------------

export type DeviceStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';

export interface PairedDevice {
  deviceId: string;
  status: DeviceStatus;
  platform: string | null;
  modelName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
}

export type DeviceSyncState =
  | 'IDLE'
  | 'SYNCING'
  | 'READY'
  | 'PARTIAL'
  | 'FAILED'
  | 'OFFLINE_PLAYBACK';

export interface DeviceSyncSnapshot {
  status: DeviceSyncState;
  manifestSource: 'REMOTE' | 'LOCAL_CACHE' | null;
  manifestVersion: string | null;
  requiredAssets: number | null;
  cachedAssets: number | null;
  failedDownloads: number | null;
  cacheSizeBytes: string | null;
  availableStorageBytes: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ScreenPairingStatus {
  screenId: string;
  screenStatus: ScreenStatus;
  paired: boolean;
  pendingCollection: boolean;
  device: PairedDevice | null;
  sync: DeviceSyncSnapshot | null;
}

// --- Phase 8: Monitoring, heartbeat, commands, screenshots ----------------

export type LiveScreenStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'WARNING'
  | 'UNPAIRED'
  | 'PAIRING'
  | 'DISABLED'
  | 'ARCHIVED';

export type DeviceCommandType =
  | 'FORCE_SYNC'
  | 'REFRESH_MANIFEST'
  | 'RESTART_PLAYBACK'
  | 'CLEAR_CACHE'
  | 'TAKE_SCREENSHOT'
  | 'REBOOT_DEVICE'
  | 'UNPAIR_DEVICE'
  | 'RELOAD_CONFIG';

export type DeviceCommandStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface ScreenshotItem {
  id: string;
  takenAt: string;
  type: 'AUTO' | 'MANUAL';
  mimeType?: string | null;
  fileSizeBytes?: string | null;
  url: string | null;
}

export interface DeviceCommand {
  id: string;
  screenId: string;
  commandType: DeviceCommandType;
  status: DeviceCommandStatus;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  issuedById: string | null;
  deliveredAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenMonitoring {
  screenId: string;
  name: string;
  status: LiveScreenStatus;
  warningReason: string | null;
  lastHeartbeatAt: string | null;
  heartbeatIntervalSeconds: number | null;
  paired: boolean;
  telemetry: {
    playbackState: string | null;
    networkStatus: string | null;
    currentContentId: string | null;
    currentPlaylistId: string | null;
    currentScheduleId: string | null;
    manifestVersion: string | null;
    uptimeSeconds: number | null;
    appVersion: string | null;
    deviceModel: string | null;
    osVersion: string | null;
    platform: string | null;
  } | null;
  cache: {
    syncStatus: DeviceSyncState | null;
    manifestSource: string | null;
    cacheSizeBytes: string | null;
    availableStorageBytes: string | null;
    requiredAssets: number | null;
    cachedAssets: number | null;
    failedDownloads: number | null;
    lastSyncAt: string | null;
    lastError: string | null;
  } | null;
  latestScreenshot: {
    id: string;
    takenAt: string;
    type: 'AUTO' | 'MANUAL';
    url: string | null;
  } | null;
  capabilities: {
    screenshot: boolean;
    reboot: boolean;
    powerControl: boolean;
    kiosk: boolean;
    autoStart: boolean;
  };
}

export interface MonitoringOverviewScreen {
  id: string;
  name: string;
  locationName: string | null;
  status: LiveScreenStatus;
  warningReason: string | null;
  lastHeartbeatAt: string | null;
  playbackState: string | null;
  currentContentId: string | null;
  syncStatus: DeviceSyncState | null;
  appVersion: string | null;
  cacheSizeBytes: string | null;
  failedDownloads: number;
  paired: boolean;
}

export interface MonitoringOverview {
  totals: {
    total: number;
    online: number;
    offline: number;
    warning: number;
    unpaired: number;
    pairing: number;
    disabled: number;
    archived: number;
  };
  syncBreakdown: Record<string, number>;
  withFailedDownloads: number;
  missingHeartbeat: number;
  alerts: { severity: 'WARNING' | 'CRITICAL'; screenId: string; name: string; message: string }[];
  screens: MonitoringOverviewScreen[];
}

// --- Phase 5: Playlists & advanced scheduling -----------------------------

export type PlaylistStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type ScheduleType = 'NORMAL' | 'CAMPAIGN';
export type ScheduleTargetType = 'SCREEN' | 'SCREEN_GROUP' | 'LOCATION' | 'COMPANY';
export type OrientationProfile = 'LANDSCAPE' | 'PORTRAIT' | 'MIXED' | 'UNKNOWN';

/** Lightweight playlist row used in list views. */
export interface PlaylistListItem {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: PlaylistStatus;
  itemCount: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PlaylistItemContent {
  id: string;
  type: ContentType;
  title: string;
  orientation: Orientation;
  status: ContentStatus;
  expiresAt: string | null;
  isExpired: boolean;
}

export interface PlaylistItem {
  id: string;
  contentId: string;
  position: number;
  durationSeconds: number | null;
  playFullVideo: boolean;
  pdfPageDurationSeconds: number | null;
  transitionType: string | null;
  settings: Record<string, unknown>;
  effectiveDurationSeconds: number;
  valid: boolean;
  issue: string | null;
  content: PlaylistItemContent;
}

export interface Playlist extends PlaylistListItem {
  items: PlaylistItem[];
  validItemCount: number;
  invalidItemCount: number;
  totalDurationSeconds: number;
  orientationProfile: OrientationProfile;
  schedulable: boolean;
  warnings: string[];
}

export interface PlaylistValidation {
  id: string;
  valid: boolean;
  schedulable: boolean;
  itemCount: number;
  validItemCount: number;
  invalidItemCount: number;
  orientationProfile: OrientationProfile;
  totalDurationSeconds: number;
  issues: { itemId: string; contentTitle: string | null; issue: string | null }[];
  warnings: string[];
}

export interface ScheduleTarget {
  id: string;
  targetType: ScheduleTargetType;
  targetId: string;
}

export interface Schedule {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  playlistId: string | null;
  playlist: { id: string; title: string; status: PlaylistStatus } | null;
  status: ScheduleStatus;
  scheduleType: ScheduleType;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  daysOfWeek: number[];
  timezone: string | null;
  recurrence: Record<string, unknown> | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  targets: ScheduleTarget[];
  targetCount: number;
}

export interface ScheduleConflictPeer {
  id: string;
  name: string;
  priority: number;
  scheduleType: ScheduleType;
}

export interface ScheduleConflictPair {
  a: ScheduleConflictPeer;
  b: ScheduleConflictPeer;
  sharedScreenIds: string[];
  winnerId: string;
}

export interface ScheduleConflicts {
  conflicts: ScheduleConflictPair[];
}

export interface ScheduleValidation {
  id: string;
  schedulable: boolean;
  playlist: { id: string | null; schedulable: boolean; validItemCount: number } | null;
  targetCount: number;
  orientationWarnings: string[];
  conflicts: { scheduleId: string; name: string; sharedScreenIds: string[]; winnerId: string }[];
  warnings: string[];
}

export type ManifestSourceType = 'SCHEDULE' | 'FALLBACK' | 'EMERGENCY' | 'NONE';

// --- Phase 9: Proof-of-Play -------------------------------------------------

export type ProofOfPlayStatus = 'STARTED' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'INTERRUPTED';
export type PlaybackSourceType = 'SCHEDULE' | 'FALLBACK' | 'EMERGENCY' | 'NONE';
export type PlaybackSourceKind =
  | 'LOCAL_CACHE'
  | 'STREAMING_SIGNED_URL'
  | 'TEXT'
  | 'URL'
  | 'PDF'
  | 'UNKNOWN';

export interface ProofOfPlayEvent {
  id: string;
  startedAt: string;
  endedAt: string | null;
  screenId: string;
  screenName: string | null;
  locationId: string | null;
  locationName: string | null;
  contentId: string | null;
  contentTitle: string | null;
  contentType: ContentType | null;
  playlistId: string | null;
  playlistTitle: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  emergencyBroadcastId: string | null;
  emergencyBroadcastTitle: string | null;
  sourceType: PlaybackSourceType;
  playbackSource: PlaybackSourceKind;
  status: ProofOfPlayStatus;
  durationMs: number | null;
  expectedDurationMs: number | null;
  offlinePlayback: boolean;
  failureReason: string | null;
  manifestVersion: string | null;
  itemSequence: number | null;
  playbackSessionId: string;
}

export interface ProofOfPlaySummary {
  totalPlays: number;
  completedPlays: number;
  failedPlays: number;
  skippedPlays: number;
  interruptedPlays: number;
  startedPlays: number;
  totalDurationMs: number;
  mostPlayedContent: Array<{ contentId: string | null; title: string | null; plays: number }>;
  screensWithFailures: Array<{ screenId: string; name: string | null; failures: number }>;
}

// --- Phase 9: Emergency Broadcast -------------------------------------------

export type EmergencyBroadcastType = 'CONTENT' | 'PLAYLIST' | 'TEXT' | 'URL';
export type EmergencyBroadcastStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED'
  | 'ARCHIVED';

export interface EmergencyBroadcastTarget {
  id: string;
  targetType: ScheduleTargetType;
  targetId: string;
}

export interface EmergencyBroadcast {
  id: string;
  title: string;
  description: string | null;
  broadcastType: EmergencyBroadcastType;
  message: string | null;
  url: string | null;
  contentId: string | null;
  playlistId: string | null;
  priority: number;
  status: EmergencyBroadcastStatus;
  startAt: string | null;
  endAt: string | null;
  stoppedAt: string | null;
  targets: EmergencyBroadcastTarget[];
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  // Present on detail / activate responses:
  affectedScreens?: number;
  warnings?: string[];
}

export interface EmergencyBroadcastValidation {
  valid: boolean;
  canActivate: boolean;
  errors: string[];
  warnings: string[];
  affectedScreens: number;
}

export interface ManifestItem {
  contentId: string;
  type: ContentType;
  title: string;
  durationSeconds: number;
  playFullVideo: boolean;
  pdfPageDurationSeconds: number | null;
  orientation: Orientation;
  fileSizeBytes: string | null;
  checksum: string | null;
  mimeType: string | null;
  signedUrl: string | null;
  url: string | null;
  textBody: string | null;
  metadata: Record<string, unknown>;
}

export interface PlaybackManifest {
  screenId: string;
  generatedAt: string;
  /** Stable content fingerprint (sha256) — see backend ScreenPlaybackManifest. */
  manifestHash: string;
  timezone: string;
  sourceType: ManifestSourceType;
  scheduleId: string | null;
  scheduleName: string | null;
  playlistId: string | null;
  playlistTitle: string | null;
  priority: number | null;
  outsideHours: boolean;
  outsideHoursBehavior: string | null;
  message: string | null;
  items: ManifestItem[];
  warnings: string[];
}

// --- Phase 10: notifications, alerts, imports, reports, backups -------------

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export interface AppNotification {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: AppNotification[];
  meta: PageMeta;
  unreadCount: number;
}

export interface Alert {
  id: string;
  companyId: string | null;
  screenId: string | null;
  deviceId: string | null;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  id: string;
  channel: 'DASHBOARD' | 'EMAIL';
  eventType: string;
  enabled: boolean;
}

export type ImportType = 'COMPANY' | 'LOCATION' | 'SCREEN' | 'USER' | 'SCREEN_GROUP' | 'TAG';
export type ImportStatus = 'UPLOADED' | 'VALIDATED' | 'COMMITTED' | 'FAILED' | 'CANCELLED';

export interface ImportJob {
  id: string;
  companyId: string | null;
  type: ImportType;
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: Array<{ line: number; errors: string[] }>;
  committedAt: string | null;
  createdAt: string;
  updatedAt: string;
  preview?: Array<{ line: number; data: Record<string, string>; valid: boolean; errors: string[] }>;
}

export type ReportType = 'PROOF_OF_PLAY' | 'SCREEN_HEALTH' | 'ALERTS' | 'ACTIVITY_LOGS' | 'BILLING';
export type ReportFormat = 'CSV' | 'XLSX' | 'PDF';
export type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ScheduledReport {
  id: string;
  name: string;
  reportType: ReportType;
  format: ReportFormat;
  frequency: ReportFrequency;
  recipients: string[];
  filters: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveries?: ScheduledReportDelivery[];
}

export interface ScheduledReportDelivery {
  id: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  recipientEmails: string[];
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface BackupRecordView {
  id: string;
  type: 'DATABASE' | 'STORAGE' | 'FULL';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  location: string | null;
  sizeBytes: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface BackupStatusResponse {
  lastSuccessfulDatabaseBackupAt: string | null;
  stale: boolean;
  staleThresholdDays: number;
  recent: BackupRecordView[];
}
