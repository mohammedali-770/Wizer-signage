import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentDevice } from '../../common/decorators/current-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceContentService } from './device-content.service';
import { DeviceService } from './device.service';
import { PairingStatusQueryDto, ReportSyncStatusDto, StartPairingDto } from './dto/device.dto';

/**
 * Device-facing API for the Android TV player (Phase 6). These routes are
 * `@Public()` (no user JWT). Pairing start/status are open + rate-limited; the
 * manifest and config are protected by {@link DeviceAuthGuard} (device token,
 * scoped to the device's own screen). No dashboard/tenant authority is granted.
 */
@ApiExcludeController()
@Public()
@Controller('device')
export class DeviceController {
  constructor(
    private readonly device: DeviceService,
    private readonly content: DeviceContentService,
  ) {}

  // UNAUTHENTICATED WRITE: every call persists a PairingCode row. The global
  // 100/min budget is far too generous for that — pairing spam would consume
  // tenant-billed storage indefinitely. A real TV pairs once, so a handful of
  // attempts per minute is ample.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('pairing/start')
  startPairing(@Body() dto: StartPairingDto) {
    return this.device.startPairing(dto);
  }

  @Get('pairing/status')
  pairingStatus(
    @Query() query: PairingStatusQueryDto,
    @Headers('x-pairing-secret') secret?: string,
  ) {
    return this.device.pairingStatus(query.code, secret);
  }

  @Get('manifest')
  @UseGuards(DeviceAuthGuard)
  manifest(@CurrentDevice() device: AuthenticatedDevice, @Query('at') at?: string) {
    return this.device.getManifest(device, at ? new Date(at) : undefined);
  }

  @Get('config')
  @UseGuards(DeviceAuthGuard)
  config(@CurrentDevice() device: AuthenticatedDevice) {
    return this.device.getConfig(device);
  }

  @Get('sync-plan')
  @UseGuards(DeviceAuthGuard)
  syncPlan(@CurrentDevice() device: AuthenticatedDevice) {
    return this.content.getSyncPlan(device);
  }

  @Post('sync-status')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  syncStatus(@CurrentDevice() device: AuthenticatedDevice, @Body() dto: ReportSyncStatusDto) {
    return this.device.recordSyncStatus(device, dto);
  }

  @Get('content/:contentId/download')
  @UseGuards(DeviceAuthGuard)
  download(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('contentId') contentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.content.download(device, contentId, req.headers.range, res);
  }
}
