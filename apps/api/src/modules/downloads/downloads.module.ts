import { Module } from '@nestjs/common';

import { DownloadsController } from './downloads.controller';

/** Serves public file downloads (e.g. the Android TV player APK). */
@Module({ controllers: [DownloadsController] })
export class DownloadsModule {}
