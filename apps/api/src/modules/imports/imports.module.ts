import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CompaniesModule } from '../companies/companies.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { LocationsModule } from '../locations/locations.module';
import { ScreenGroupsModule } from '../screen-groups/screen-groups.module';
import { ScreensModule } from '../screens/screens.module';
import { TagsModule } from '../tags/tags.module';
import { ImportService } from './import.service';
import { ImportsController } from './imports.controller';

/**
 * Phase 10 — bulk CSV/XLSX imports. Reuses the entity create services (same
 * validation + plan limits) rather than re-implementing them.
 */
@Module({
  imports: [
    ActivityLogModule,
    LocationsModule,
    ScreensModule,
    ScreenGroupsModule,
    TagsModule,
    InvitationsModule,
    CompaniesModule,
  ],
  controllers: [ImportsController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportsModule {}
