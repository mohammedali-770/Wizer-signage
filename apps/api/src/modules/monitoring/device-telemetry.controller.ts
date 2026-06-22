import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiExcludeController } from '@nestjs/swagger';

import { CurrentDevice } from '../../common/decorators/current-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { DeviceAuthGuard } from '../device/device-auth.guard';
import { DeviceCommandService } from './device-command.service';
import { HeartbeatService } from './heartbeat.service';
import { ScreenshotService } from './screenshot.service';
import { CommandResultDto, HeartbeatDto, ScreenshotUploadDto } from './dto/monitoring.dto';

// 12 MB cap on screenshot uploads.
const SCREENSHOT_LIMIT = { limits: { fileSize: 12 * 1024 * 1024 } };

/**
 * Device-facing monitoring API (Phase 8). All routes are `@Public()` + governed
 * by {@link DeviceAuthGuard}; each is strictly scoped to the device's own screen.
 */
@ApiExcludeController()
@Public()
@UseGuards(DeviceAuthGuard)
@Controller('device')
export class DeviceTelemetryController {
  constructor(
    private readonly heartbeat: HeartbeatService,
    private readonly commands: DeviceCommandService,
    private readonly screenshots: ScreenshotService,
  ) {}

  @Post('heartbeat')
  @HttpCode(200)
  reportHeartbeat(@CurrentDevice() device: AuthenticatedDevice, @Body() dto: HeartbeatDto) {
    return this.heartbeat.record(device, dto);
  }

  @Get('commands/pending')
  pendingCommands(@CurrentDevice() device: AuthenticatedDevice) {
    return this.commands.pending(device);
  }

  @Post('commands/:id/ack')
  @HttpCode(200)
  ackCommand(@CurrentDevice() device: AuthenticatedDevice, @Param('id') id: string) {
    return this.commands.ack(device, id);
  }

  @Post('commands/:id/result')
  @HttpCode(200)
  commandResult(
    @CurrentDevice() device: AuthenticatedDevice,
    @Param('id') id: string,
    @Body() dto: CommandResultDto,
  ) {
    return this.commands.result(device, id, dto);
  }

  @Post('screenshots')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', SCREENSHOT_LIMIT))
  @ApiConsumes('multipart/form-data')
  uploadScreenshot(
    @CurrentDevice() device: AuthenticatedDevice,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ScreenshotUploadDto,
  ) {
    return this.screenshots.upload(device, file, dto);
  }
}
