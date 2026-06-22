import type { UserRole } from './types';

/** Landing area for a role: Super Admins use /admin, company users use /company. */
export function roleHome(role: UserRole | null | undefined): '/admin' | '/company' {
  return role === 'SUPER_ADMIN' ? '/admin' : '/company';
}
