import { Global, Module } from '@nestjs/common';

import { ContentFilesController } from './content-files.controller';
import { StorageService } from './storage.service';

/** Global storage module (Supabase in prod, local dev adapter as fallback). */
@Global()
@Module({
  controllers: [ContentFilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
