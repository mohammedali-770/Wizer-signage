import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles. SUPER_ADMIN always passes (platform
 * override). Combine with tenant scoping in the service layer.
 *
 * ```ts
 * @Roles(UserRole.COMPANY_ADMIN)
 * ```
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
