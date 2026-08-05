import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { DeviceCommandType } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { DeviceCommandService } from './device-command.service';
import { MonitoringService } from './monitoring.service';
import { ScreenshotService } from './screenshot.service';
import { IssueCommandDto, ListCommandsQueryDto } from './dto/monitoring.dto';
import {
  DeviceCommandDto,
  ScreenMonitoringDto,
  ScreenshotSummaryDto,
} from './dto/monitoring-response.dto';

/**
 * Dashboard-facing per-screen monitoring + remote actions (Phase 8). Reads need
 * `screen:read`; issuing commands needs `screen:command` (Company Admin /
 * Location Manager) — Viewer/Content Manager are read-only. Company-scoped.
 */
@ApiTags('screens')
@ApiBearerAuth()
@Controller('screens')
export class ScreenMonitoringController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly commands: DeviceCommandService,
    private readonly screenshots: ScreenshotService,
  ) {}

  @Get(':id/monitoring')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({
    summary: 'Live status + telemetry + cache/sync + latest screenshot for a screen.',
  })
  @ApiOkResponse({ type: ScreenMonitoringDto })
  screenMonitoring(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.monitoring.screenMonitoring(companyId, id);
  }

  @Get(':id/screenshots')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Paginated screenshot history for a screen, newest first.' })
  @ApiPaginatedResponse(ScreenshotSummaryDto)
  screenshotHistory(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.screenshots.list(companyId, id, query);
  }

  @Get(':id/commands')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Paginated remote-command history for a screen.' })
  @ApiPaginatedResponse(DeviceCommandDto)
  listCommands(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Query() query: ListCommandsQueryDto,
  ) {
    return this.commands.list(companyId, id, query);
  }

  @Get(':id/commands/:commandId')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Get one remote command, including its result or error.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  getCommand(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Param('commandId') commandId: string,
  ) {
    return this.commands.get(companyId, id, commandId);
  }

  @Post(':id/commands')
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Issue a remote command to a screen.' })
  // Created, not Ok: this @Post carries no @HttpCode, so Nest answers 201. The
  // six action routes below DO set @HttpCode(200) and use ApiOkResponse.
  @ApiCreatedResponse({ type: DeviceCommandDto })
  issueCommand(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: IssueCommandDto,
  ) {
    return this.commands.issue(companyId, user, id, dto.commandType, dto.payload);
  }

  // --- Convenience action endpoints -------------------------------------

  @Post(':id/actions/force-sync')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Force a full re-sync of the screen’s assets.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  forceSync(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.FORCE_SYNC);
  }

  @Post(':id/actions/refresh-manifest')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Ask the screen to re-fetch its playback manifest.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  refreshManifest(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.REFRESH_MANIFEST);
  }

  @Post(':id/actions/restart-playback')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Restart playback on the screen.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  restartPlayback(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.RESTART_PLAYBACK);
  }

  @Post(':id/actions/clear-cache')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Clear the screen’s local asset cache.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  clearCache(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.CLEAR_CACHE);
  }

  @Post(':id/actions/take-screenshot')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Ask the screen to capture and upload a screenshot.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  takeScreenshot(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.TAKE_SCREENSHOT);
  }

  @Post(':id/actions/reboot')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenCommand)
  @ApiOperation({ summary: 'Reboot the device.' })
  @ApiOkResponse({ type: DeviceCommandDto })
  reboot(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commands.issue(companyId, user, id, DeviceCommandType.REBOOT_DEVICE);
  }
}
