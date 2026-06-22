import { AsyncLocalStorage } from 'node:async_hooks';

import { ForbiddenException, Injectable } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

/** Request-scoped tenant/principal context propagated via AsyncLocalStorage. */
export interface TenantStore {
  userId: string;
  role: UserRole;
  companyId: string | null;
  sessionId: string;
  isSuperAdmin: boolean;
  ip?: string;
  userAgent?: string;
}

/**
 * Holds the resolved tenant context for the lifetime of a request using
 * AsyncLocalStorage, so cross-cutting concerns (audit logging) can read the
 * acting company/user/ip without threading them through every call.
 *
 * The authoritative source of `companyId` is still the verified token; this
 * store is populated from `req.user` by {@link TenantContextInterceptor}.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  run<T>(store: TenantStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  get store(): TenantStore | undefined {
    return this.als.getStore();
  }

  get companyId(): string | null {
    return this.als.getStore()?.companyId ?? null;
  }

  get userId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  get isSuperAdmin(): boolean {
    return this.als.getStore()?.isSuperAdmin ?? false;
  }

  /**
   * Returns the active companyId or throws — use in tenant-scoped code paths
   * that must never run without a tenant.
   */
  requireCompanyId(): string {
    const companyId = this.companyId;
    if (!companyId) {
      throw new ForbiddenException('A tenant (company) context is required for this operation.');
    }
    return companyId;
  }
}
