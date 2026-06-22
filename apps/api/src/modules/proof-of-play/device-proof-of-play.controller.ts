import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CurrentDevice } from '../../common/decorators/current-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { DeviceAuthGuard } from '../device/device-auth.guard';
import { ReportProofOfPlayDto } from './dto/proof-of-play.dto';
import { ProofOfPlayService } from './proof-of-play.service';

/**
 * Device-facing proof-of-play ingest (Phase 9). `@Public()` + DeviceAuthGuard;
 * strictly scoped to the device's own screen. A single batch endpoint accepts
 * online pushes and flushed offline buffers alike, and is idempotent on
 * `playbackSessionId`.
 */
@ApiExcludeController()
@Public()
@UseGuards(DeviceAuthGuard)
@Controller('device/proof-of-play')
export class DeviceProofOfPlayController {
  constructor(private readonly proofOfPlay: ProofOfPlayService) {}

  @Post('events')
  @HttpCode(200)
  reportEvents(@CurrentDevice() device: AuthenticatedDevice, @Body() dto: ReportProofOfPlayDto) {
    return this.proofOfPlay.ingest(device, dto);
  }
}
