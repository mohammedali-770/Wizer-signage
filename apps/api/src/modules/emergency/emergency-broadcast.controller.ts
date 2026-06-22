import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateEmergencyBroadcastDto,
  EmergencyTargetDto,
  ListEmergencyBroadcastsQueryDto,
  QuickTextBroadcastDto,
  UpdateEmergencyBroadcastDto,
} from './dto/emergency-broadcast.dto';
import { EmergencyBroadcastService } from './emergency-broadcast.service';

/**
 * Emergency Broadcast API (Phase 9). Reads require `screen:read` (Viewers can
 * see what is live); every mutation requires `emergency:send` (Company Admin +
 * Location Manager). All routes are company-scoped via the tenant guard.
 */
@ApiTags('emergency-broadcasts')
@ApiBearerAuth()
@Controller('emergency-broadcasts')
export class EmergencyBroadcastController {
  constructor(private readonly emergency: EmergencyBroadcastService) {}

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'List emergency broadcasts (filter by status/search).' })
  list(@CurrentCompany() companyId: string, @Query() query: ListEmergencyBroadcastsQueryDto) {
    return this.emergency.list(companyId, query);
  }

  @Post()
  @RequirePermissions(Permission.EmergencySend)
  @ApiOperation({ summary: 'Create an emergency broadcast (DRAFT).' })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmergencyBroadcastDto,
  ) {
    return this.emergency.create(companyId, user, dto);
  }

  @Post('quick-text')
  @RequirePermissions(Permission.EmergencySend)
  @ApiOperation({ summary: 'Create and immediately activate a text emergency broadcast.' })
  quickText(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuickTextBroadcastDto,
  ) {
    return this.emergency.quickText(companyId, user, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Emergency broadcast detail (with validation + affected screens).' })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.emergency.getDetail(companyId, id);
  }

  @Get(':id/validate')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Validation report (errors, warnings, affected screen count).' })
  validate(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.emergency.validate(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.EmergencySend)
  @ApiOperation({ summary: 'Update an emergency broadcast.' })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyBroadcastDto,
  ) {
    return this.emergency.update(companyId, user, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.EmergencySend)
  activate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.emergency.activate(companyId, user, id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.EmergencySend)
  pause(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.emergency.pause(companyId, user, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequirePermissions(Permission.EmergencySend)
  end(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.emergency.end(companyId, user, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.EmergencySend)
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.emergency.archive(companyId, user, id);
  }

  @Post(':id/targets')
  @HttpCode(200)
  @RequirePermissions(Permission.EmergencySend)
  addTarget(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EmergencyTargetDto,
  ) {
    return this.emergency.addTarget(companyId, user, id, dto);
  }

  @Delete(':id/targets/:targetId')
  @RequirePermissions(Permission.EmergencySend)
  removeTarget(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('targetId') targetId: string,
  ) {
    return this.emergency.removeTarget(companyId, user, id, targetId);
  }
}
