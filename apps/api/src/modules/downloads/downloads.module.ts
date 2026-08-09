import { Module } from '@nestjs/common';

import { AndroidReleaseCatalogService } from './android-release-catalog.service';
import { DownloadsController } from './downloads.controller';

/** Serves public file downloads and verifies immutable Android release entries. */
@Module({
  controllers: [DownloadsController],
  providers: [AndroidReleaseCatalogService],
  exports: [AndroidReleaseCatalogService],
})
export class DownloadsModule {}
