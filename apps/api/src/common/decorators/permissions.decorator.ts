import { SetMetadata } from '@nestjs/common';

import type { Permission } from '../rbac/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Requires the caller to hold ALL listed permissions (enforced by
 * PermissionsGuard). SUPER_ADMIN implicitly holds every permission.
 *
 * ```ts
 * @RequirePermissions(Permission.UserInvite)
 * ```
 */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);
