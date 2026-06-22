import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { PlaybackManifestController } from './playback-manifest.controller';
import { ScheduleResolverService } from './schedule-resolver.service';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [ActivityLogModule, PlaylistsModule],
  controllers: [SchedulesController, PlaybackManifestController],
  providers: [SchedulesService, ScheduleResolverService],
  exports: [SchedulesService, ScheduleResolverService],
})
export class SchedulesModule {}
