import { Body, Controller, Delete, Get, HttpCode, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { SetDefaultKioskPinDto, UpdateCompanySettingsDto } from './dto/company-settings.dto';
import { CompanySettingsService } from './company-settings.service';

@ApiTags('company-settings')
@ApiBearerAuth()
@Controller('company-settings')
export class CompanySettingsController {
  constructor(private readonly settings: CompanySettingsService) {}

  @Get()
  @RequirePermissions(Permission.CompanyRead)
  @ApiOperation({ summary: "Get the current company's settings (billing read-only)." })
  get(@CurrentCompany() companyId: string) {
    return this.settings.get(companyId);
  }

  @Get('usage')
  @RequirePermissions(Permission.CompanyRead)
  @ApiOperation({ summary: "The company's usage vs plan limits (with grace status)." })
  usage(@CurrentCompany() companyId: string) {
    return this.settings.usage(companyId);
  }

  @Patch()
  @RequirePermissions(Permission.CompanyManage)
  @ApiOperation({ summary: 'Update company settings (name/timezone/defaults/working hours).' })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanySettingsDto,
  ) {
    return this.settings.update(companyId, user, dto);
  }

  @Put('kiosk-pin')
  @RequirePermissions(Permission.CompanyManage)
  @ApiOperation({ summary: 'Set the company default kiosk PIN (stored hashed).' })
  setKioskPin(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetDefaultKioskPinDto,
  ) {
    return this.settings.setDefaultKioskPin(companyId, user, dto.pin);
  }

  @Delete('kiosk-pin')
  @HttpCode(200)
  @RequirePermissions(Permission.CompanyManage)
  @ApiOperation({ summary: 'Clear the company default kiosk PIN.' })
  resetKioskPin(@CurrentCompany() companyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.resetDefaultKioskPin(companyId, user);
  }
}
