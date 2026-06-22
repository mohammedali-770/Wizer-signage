import { UserRole } from '@prisma/client';

import { hasPermission, Permission, ROLE_PERMISSIONS } from './permissions';

describe('RBAC permissions', () => {
  it('grants Super Admin every permission', () => {
    for (const permission of Object.values(Permission)) {
      expect(hasPermission(UserRole.SUPER_ADMIN, permission)).toBe(true);
    }
  });

  it('grants Company Admin user management but not platform management', () => {
    expect(hasPermission(UserRole.COMPANY_ADMIN, Permission.UserInvite)).toBe(true);
    expect(hasPermission(UserRole.COMPANY_ADMIN, Permission.BillingManage)).toBe(true);
    expect(hasPermission(UserRole.COMPANY_ADMIN, Permission.PlatformManage)).toBe(false);
    expect(hasPermission(UserRole.COMPANY_ADMIN, Permission.ApkManage)).toBe(false);
  });

  it('restricts Content Manager to content, not users', () => {
    expect(hasPermission(UserRole.CONTENT_MANAGER, Permission.ContentManage)).toBe(true);
    expect(hasPermission(UserRole.CONTENT_MANAGER, Permission.UserInvite)).toBe(false);
    expect(hasPermission(UserRole.CONTENT_MANAGER, Permission.ScreenManage)).toBe(false);
  });

  it('restricts Viewer to read-only', () => {
    expect(hasPermission(UserRole.VIEWER, Permission.ContentRead)).toBe(true);
    expect(hasPermission(UserRole.VIEWER, Permission.ContentManage)).toBe(false);
    expect(hasPermission(UserRole.VIEWER, Permission.UserInvite)).toBe(false);
  });

  it('Location Manager can command screens but not invite users', () => {
    expect(hasPermission(UserRole.LOCATION_MANAGER, Permission.ScreenCommand)).toBe(true);
    expect(hasPermission(UserRole.LOCATION_MANAGER, Permission.EmergencySend)).toBe(true);
    expect(hasPermission(UserRole.LOCATION_MANAGER, Permission.UserInvite)).toBe(false);
  });

  it('every non-platform role has a defined permission set', () => {
    for (const role of Object.values(UserRole)) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });
});
