import { Module } from '@nestjs/common';

import { ActivityLogModule } from '../activity-log/activity-log.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { DeviceAuthGuard } from './device-auth.guard';
import { DeviceContentService } from './device-content.service';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { ScreenPairingController } from './screen-pairing.controller';

@Module({
  imports: [ActivityLogModule, SchedulesModule],
  controllers: [DeviceController, ScreenPairingController],
  providers: [DeviceService, DeviceContentService, DeviceAuthGuard],
  exports: [DeviceService, DeviceAuthGuard],
})
export class DeviceModule {}
