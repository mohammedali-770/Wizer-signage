import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ManifestRefreshModule } from '../sync/manifest-refresh.module';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

@Module({
  imports: [ActivityLogModule, ManifestRefreshModule],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
