import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateScheduledReportDto,
  ListScheduledReportsQueryDto,
  UpdateScheduledReportDto,
} from './dto/scheduled-report.dto';
import { ScheduledReportService } from './scheduled-report.service';

/**
 * Scheduled reports (Phase 10). Reads require `report:read`; create/manage/run
 * require `report:schedule` (Company Admin). Company-scoped throughout.
 */
@ApiTags('scheduled-reports')
@ApiBearerAuth()
@Controller('scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly reports: ScheduledReportService) {}

  @Get()
  @RequirePermissions(Permission.ReportRead)
  list(@CurrentCompany() companyId: string, @Query() query: ListScheduledReportsQueryDto) {
    return this.reports.list(companyId, query);
  }

  @Post()
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({ summary: 'Create a scheduled report.' })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduledReportDto,
  ) {
    return this.reports.create(companyId, user, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.ReportRead)
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.reports.get(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ReportSchedule)
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledReportDto,
  ) {
    return this.reports.update(companyId, user, id, dto);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermissions(Permission.ReportSchedule)
  enable(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.setEnabled(companyId, user, id, true);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions(Permission.ReportSchedule)
  disable(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.setEnabled(companyId, user, id, false);
  }

  @Post(':id/run')
  @HttpCode(200)
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({ summary: 'Run the report now and email it.' })
  run(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.runNow(companyId, user, id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ReportSchedule)
  remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.remove(companyId, user, id);
  }
}
