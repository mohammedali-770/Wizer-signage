import { Module } from '@nestjs/common';

import { ManifestRefreshInterceptor } from './manifest-refresh.interceptor';
import { ManifestRefreshService } from './manifest-refresh.service';

/**
 * Provides ManifestRefreshService + ManifestRefreshInterceptor for the content /
 * playlist / schedule modules to push REFRESH_MANIFEST to a company's screens
 * after a change. Intentionally has NO imports (PrismaModule is @Global) so
 * importing it cannot create a circular dependency with DeviceModule /
 * MonitoringModule.
 */
@Module({
  providers: [ManifestRefreshService, ManifestRefreshInterceptor],
  exports: [ManifestRefreshService, ManifestRefreshInterceptor],
})
export class ManifestRefreshModule {}
