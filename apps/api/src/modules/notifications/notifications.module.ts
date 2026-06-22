import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { AlertService } from './alert.service';
import { AlertsController } from './alerts.controller';
import { EmailService } from './email.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

/**
 * Phase 10 — notifications, alerts, and audited email. MailService is global;
 * Prisma is global. Exports AlertService + EmailService so feature modules
 * (monitoring, emergency, billing, maintenance) can raise alerts and the
 * scheduled-report runner can send mail through the same audited path.
 */
@Module({
  imports: [ActivityLogModule],
  controllers: [NotificationsController, AlertsController],
  providers: [AlertService, NotificationService, NotificationPreferenceService, EmailService],
  exports: [AlertService, NotificationService, EmailService],
})
export class NotificationsModule {}
