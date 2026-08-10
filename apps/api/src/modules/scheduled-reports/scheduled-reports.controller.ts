import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ApiPaginatedResponse, OkResponseDto } from '../../common/dto/api-response.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateScheduledReportDto,
  ListScheduledReportsQueryDto,
  UpdateScheduledReportDto,
} from './dto/scheduled-report.dto';
import { ScheduledReportDetailDto, ScheduledReportDto } from './dto/scheduled-report-response.dto';
import { ScheduledReportQueueService } from './scheduled-report-queue.service';
import { ScheduledReportService } from './scheduled-report.service';

@ApiTags('scheduled-reports')
@ApiBearerAuth()
@Controller('scheduled-reports')
export class ScheduledReportsController {
  constructor(
    private readonly reports: ScheduledReportService,
    private readonly queue: ScheduledReportQueueService,
  ) {}

  @Get()
  @RequirePermissions(Permission.ReportRead)
  @ApiOperation({ summary: 'List scheduled reports, newest first.' })
  @ApiPaginatedResponse(ScheduledReportDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListScheduledReportsQueryDto) {
    return this.reports.list(companyId, query);
  }

  @Post()
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({ summary: 'Create a scheduled report.' })
  @ApiCreatedResponse({ type: ScheduledReportDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduledReportDto,
  ) {
    return this.reports.create(companyId, user, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.ReportRead)
  @ApiOperation({ summary: 'Get a scheduled report with its recent delivery history.' })
  @ApiOkResponse({ type: ScheduledReportDetailDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.reports.get(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({ summary: 'Update a scheduled report.' })
  @ApiOkResponse({ type: ScheduledReportDto })
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
  @ApiOperation({ summary: 'Enable a scheduled report.' })
  @ApiOkResponse({ type: ScheduledReportDto })
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
  @ApiOperation({ summary: 'Disable a scheduled report (keeps its schedule, never runs).' })
  @ApiOkResponse({ type: ScheduledReportDto })
  disable(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.setEnabled(companyId, user, id, false);
  }

  @Post(':id/run')
  @HttpCode(202)
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({
    summary: 'Queue an enabled report for the maintenance worker to generate and email.',
  })
  @ApiAcceptedResponse({
    schema: {
      type: 'object',
      required: ['accepted', 'scheduledReportId', 'queuedAt'],
      properties: {
        accepted: { type: 'boolean', example: true },
        scheduledReportId: { type: 'string', format: 'uuid' },
        queuedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  run(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.queue.queue(companyId, user, id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ReportSchedule)
  @ApiOperation({ summary: 'Delete a scheduled report and its delivery history.' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reports.remove(companyId, user, id);
  }
}
