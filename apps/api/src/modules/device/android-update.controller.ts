import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CurrentDevice } from '../../common/decorators/current-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { AndroidUpdateService } from './android-update.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { AndroidUpdateResultDto } from './dto/android-update.dto';

@ApiExcludeController()
@Public()
@Controller('device/update')
@UseGuards(DeviceAuthGuard)
export class AndroidUpdateController {
  constructor(private readonly updates: AndroidUpdateService) {}

  @Get('policy')
  policy(@CurrentDevice() device: AuthenticatedDevice) {
    return this.updates.getPolicy(device);
  }

  @Post('result')
  @HttpCode(200)
  result(@CurrentDevice() device: AuthenticatedDevice, @Body() dto: AndroidUpdateResultDto) {
    return this.updates.recordResult(device, dto);
  }
}
