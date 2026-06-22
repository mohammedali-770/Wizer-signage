import { UserRole } from '@prisma/client';

/**
 * Granular permission catalog (resource:action).
 *
 * Enforced server-side by the PermissionsGuard. Roles map to a fixed set of
 * permissions below. This catalog is forward-looking: it includes permissions
 * for resources whose feature modules arrive in later phases so guards can be
 * declared once and remain stable.
 *
 * SUPER_ADMIN is a platform role and implicitly holds every permission (see
 * {@link hasPermission}); it is not listed in the per-role map.
 */
export enum Permission {
  // Company / tenant
  CompanyRead = 'company:read',
  CompanyUpdate = 'company:update',
  CompanyManage = 'company:manage', // settings, billing, suspension
  // Users & access
  UserRead = 'user:read',
  UserInvite = 'user:invite',
  UserUpdate = 'user:update',
  UserDelete = 'user:delete',
  // Sessions
  SessionReadOwn = 'session:read:own',
  SessionTerminateOwn = 'session:terminate:own',
  SessionManage = 'session:manage', // terminate other users' sessions
  // Audit
  ActivityRead = 'activity:read',
  // Fleet (Phase 3)
  LocationRead = 'location:read',
  LocationManage = 'location:manage',
  ScreenRead = 'screen:read',
  ScreenManage = 'screen:manage',
  ScreenCommand = 'screen:command',
  // Content & scheduling (Phases 4-5)
  ContentRead = 'content:read',
  ContentManage = 'content:manage',
  PlaylistRead = 'playlist:read',
  PlaylistManage = 'playlist:manage',
  ScheduleRead = 'schedule:read',
  ScheduleManage = 'schedule:manage',
  EmergencySend = 'emergency:send',
  // Reporting
  ReportRead = 'report:read',
  ReportSchedule = 'report:schedule', // create/manage scheduled reports (Phase 10)
  // Operations (Phase 10)
  AlertRead = 'alert:read',
  AlertManage = 'alert:manage', // acknowledge / resolve / dismiss
  ImportRun = 'import:run',
  // Billing (Phase 2/10)
  BillingManage = 'billing:manage',
  // Integrations (Phase 10)
  ApiKeyManage = 'apikey:manage',
  WebhookManage = 'webhook:manage',
  // Platform (Super Admin only)
  PlatformManage = 'platform:manage',
  ApkManage = 'apk:manage',
}

const READ_ONLY: Permission[] = [
  Permission.CompanyRead,
  Permission.UserRead,
  Permission.SessionReadOwn,
  Permission.SessionTerminateOwn,
  Permission.LocationRead,
  Permission.ScreenRead,
  Permission.ContentRead,
  Permission.PlaylistRead,
  Permission.ScheduleRead,
  Permission.ReportRead,
  Permission.AlertRead,
];

const CONTENT_CREATOR: Permission[] = [
  Permission.CompanyRead,
  Permission.SessionReadOwn,
  Permission.SessionTerminateOwn,
  Permission.LocationRead,
  Permission.ScreenRead,
  Permission.ContentRead,
  Permission.ContentManage,
  Permission.PlaylistRead,
  Permission.PlaylistManage,
  Permission.ScheduleRead,
  Permission.ScheduleManage,
  Permission.ReportRead,
  Permission.AlertRead,
];

const LOCATION_MANAGER: Permission[] = [
  ...CONTENT_CREATOR,
  Permission.ScreenManage,
  Permission.ScreenCommand,
  Permission.EmergencySend,
  Permission.AlertManage,
];

const COMPANY_ADMIN: Permission[] = [
  Permission.CompanyRead,
  Permission.CompanyUpdate,
  Permission.CompanyManage,
  Permission.UserRead,
  Permission.UserInvite,
  Permission.UserUpdate,
  Permission.UserDelete,
  Permission.SessionReadOwn,
  Permission.SessionTerminateOwn,
  Permission.SessionManage,
  Permission.ActivityRead,
  Permission.LocationRead,
  Permission.LocationManage,
  Permission.ScreenRead,
  Permission.ScreenManage,
  Permission.ScreenCommand,
  Permission.ContentRead,
  Permission.ContentManage,
  Permission.PlaylistRead,
  Permission.PlaylistManage,
  Permission.ScheduleRead,
  Permission.ScheduleManage,
  Permission.EmergencySend,
  Permission.ReportRead,
  Permission.ReportSchedule,
  Permission.AlertRead,
  Permission.AlertManage,
  Permission.ImportRun,
  Permission.BillingManage,
  Permission.ApiKeyManage,
  Permission.WebhookManage,
];

/** Permissions granted to each non-platform role. */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission), // all (also short-circuited below)
  [UserRole.COMPANY_ADMIN]: COMPANY_ADMIN,
  [UserRole.LOCATION_MANAGER]: LOCATION_MANAGER,
  [UserRole.CONTENT_MANAGER]: CONTENT_CREATOR,
  [UserRole.VIEWER]: READ_ONLY,
};

/** True when `role` holds `permission`. SUPER_ADMIN holds everything. */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === UserRole.SUPER_ADMIN) return true;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
