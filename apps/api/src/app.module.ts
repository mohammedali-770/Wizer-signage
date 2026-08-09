import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { CommonModule } from './common/common.module';
import { TenantContextInterceptor } from './common/context/tenant-context.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DeviceAwareThrottlerGuard } from './common/guards/device-aware-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TwoFactorEnforcementGuard } from './common/guards/two-factor.guard';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { UsersModule } from './modules/users/users.module';
import { TwoFactorModule } from './modules/two-factor/two-factor.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsageLimitsModule } from './modules/usage-limits/usage-limits.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { LocationsModule } from './modules/locations/locations.module';
import { ScreensModule } from './modules/screens/screens.module';
import { ScreenGroupsModule } from './modules/screen-groups/screen-groups.module';
import { TagsModule } from './modules/tags/tags.module';
import { CompanySettingsModule } from './modules/company-settings/company-settings.module';
import { StorageModule } from './modules/storage/storage.module';
import { ContentModule } from './modules/content/content.module';
import { PlaylistsModule } from './modules/playlists/playlists.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { DeviceModule } from './modules/device/device.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ProofOfPlayModule } from './modules/proof-of-play/proof-of-play.module';
import { EmergencyBroadcastModule } from './modules/emergency/emergency-broadcast.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ExportsModule } from './modules/exports/exports.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ScheduledReportsModule } from './modules/scheduled-reports/scheduled-reports.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { DownloadsModule } from './modules/downloads/downloads.module';
import { PublicModule } from './modules/public/public.module';
import { MetricsMiddleware } from './modules/observability/metrics.middleware';
import { ObservabilityModule } from './modules/observability/observability.module';

/**
 * Root application module (Phase 1).
 *
 * Wires global config, Prisma, the common cross-cutting layer, mail, and the
 * Identity/Auth/Tenancy feature modules. Global providers enforce, in order:
 * rate limiting -> authentication -> roles -> permissions -> tenant presence ->
 * mandatory-2FA, then populate the request-scoped tenant context and normalize
 * all errors into the platform envelope.
 *
 * Observability is intentionally cross-cutting: request metrics are middleware
 * so rejected throttled/auth requests are counted as well as successful ones.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    ObservabilityModule,
    MailModule,
    HealthModule,
    DownloadsModule,
    PublicModule,
    ActivityLogModule,
    CompaniesModule,
    SessionsModule,
    UsersModule,
    TwoFactorModule,
    InvitationsModule,
    AuthModule,
    UsageLimitsModule,
    PlansModule,
    SubscriptionsModule,
    InvoicesModule,
    SuperAdminModule,
    LocationsModule,
    ScreensModule,
    ScreenGroupsModule,
    TagsModule,
    CompanySettingsModule,
    StorageModule,
    ContentModule,
    PlaylistsModule,
    SchedulesModule,
    DeviceModule,
    MonitoringModule,
    ProofOfPlayModule,
    EmergencyBroadcastModule,
    NotificationsModule,
    ExportsModule,
    ImportsModule,
    ScheduledReportsModule,
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: DeviceAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: TwoFactorEnforcementGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  /**
   * Correlation IDs and request metrics must be assigned before ANY guard,
   * interceptor, or filter runs — a request rejected by the throttler or auth
   * guard is exactly the kind of failure operators need to diagnose.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
