import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ScreenGroupsController } from './screen-groups.controller';
import { ScreenGroupsService } from './screen-groups.service';

@Module({
  imports: [ActivityLogModule],
  controllers: [ScreenGroupsController],
  providers: [ScreenGroupsService],
  exports: [ScreenGroupsService],
})
export class ScreenGroupsModule {}
