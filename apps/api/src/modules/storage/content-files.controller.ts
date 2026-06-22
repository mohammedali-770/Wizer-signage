import { Controller, Get, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from './storage.service';

/**
 * Serves locally-stored files for the dev storage adapter. The token is an
 * encrypted, time-limited reference to a storage key (see StorageService).
 * In production (Supabase) this route is unused — signed URLs point at Supabase.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('content-files')
export class ContentFilesController {
  constructor(private readonly storage: StorageService) {}

  @Get(':token')
  serve(@Param('token') token: string, @Res() res: Response): Promise<void> {
    return this.storage.streamLocal(token, res);
  }
}
