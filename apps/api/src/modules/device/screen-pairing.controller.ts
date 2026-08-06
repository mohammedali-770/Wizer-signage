import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { DeviceService } from './device.service';
import { PairingStatusDto } from './dto/pairing-response.dto';
import { PairScreenDto } from './dto/device.dto';

/**
 * Dashboard-facing pairing actions, scoped to a company screen. Declared under
 * the `screens` resource (separate controller so ScreensModule stays untouched).
 */
@ApiTags('screens')
@ApiBearerAuth()
@Controller('screens')
export class ScreenPairingController {
  constructor(private readonly device: DeviceService) {}

  @Post(':id/pair')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Pair a screen by entering the code shown on the TV.' })
  // Re-reads the status rather than reporting what it did, so all three
  // pairing routes share one response shape.
  @ApiOkResponse({ type: PairingStatusDto })
  pair(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PairScreenDto,
  ) {
    return this.device.pairScreen(companyId, user, id, dto);
  }

  @Post(':id/unpair')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Unpair a screen (revokes the device token).' })
  @ApiOkResponse({ type: PairingStatusDto })
  unpair(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.device.unpairScreen(companyId, user, id);
  }

  @Get(':id/pairing-status')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Pairing + device status for a screen.' })
  @ApiOkResponse({ type: PairingStatusDto })
  status(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.device.getPairingStatus(companyId, id);
  }
}
