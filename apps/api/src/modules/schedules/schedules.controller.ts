import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse, DeletedResponseDto } from '../../common/dto/api-response.dto';
import { ScheduleDto } from '../../common/dto/entity-response.dto';
import { ScheduleConflictsDto, ScheduleValidationDto } from './dto/validation-response.dto';
import { ScheduleStatus } from '@prisma/client';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ManifestRefreshInterceptor } from '../sync/manifest-refresh.interceptor';
import {
  AddScheduleTargetDto,
  CreateScheduleDto,
  ListSchedulesQueryDto,
  UpdateScheduleDto,
} from './dto/schedule.dto';
import { SchedulesService } from './schedules.service';

@ApiTags('schedules')
@ApiBearerAuth()
@Controller('schedules')
@UseInterceptors(ManifestRefreshInterceptor)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequirePermissions(Permission.ScheduleRead)
  @ApiOperation({ summary: 'List schedules (filter by status/type/target/date/priority/search).' })
  @ApiPaginatedResponse(ScheduleDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListSchedulesQueryDto) {
    return this.schedules.list(companyId, query);
  }

  @Post()
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Create a schedule (with optional targets).' })
  @ApiCreatedResponse({ type: ScheduleDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.schedules.create(companyId, user, dto);
  }

  @Get('conflicts')
  @RequirePermissions(Permission.ScheduleRead)
  @ApiOperation({ summary: 'All overlapping ACTIVE schedule pairs (shared screens + winner).' })
  // A one-key OBJECT, not a bare array — the field and the endpoint share a
  // name, which is how it gets documented as an array.
  @ApiOkResponse({ type: ScheduleConflictsDto })
  conflicts(@CurrentCompany() companyId: string) {
    return this.schedules.conflicts(companyId);
  }

  @Get(':id')
  @RequirePermissions(Permission.ScheduleRead)
  @ApiOperation({ summary: 'Schedule detail.' })
  @ApiOkResponse({ type: ScheduleDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.schedules.getDetail(companyId, id);
  }

  @Get(':id/validate')
  @RequirePermissions(Permission.ScheduleRead)
  @ApiOkResponse({ type: ScheduleValidationDto })
  @ApiOperation({
    summary: 'Validation summary (playlist/targets, orientation + conflict warnings).',
  })
  validate(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.schedules.validate(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Update a schedule.' })
  @ApiOkResponse({ type: ScheduleDto })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedules.update(companyId, user, id, dto);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Pause a schedule.' })
  @ApiOkResponse({ type: ScheduleDto })
  pause(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.setStatus(companyId, user, id, ScheduleStatus.PAUSED);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Resume a paused schedule.' })
  @ApiOkResponse({ type: ScheduleDto })
  resume(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.setStatus(companyId, user, id, ScheduleStatus.ACTIVE);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Archive a schedule.' })
  @ApiOkResponse({ type: ScheduleDto })
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.setStatus(companyId, user, id, ScheduleStatus.ARCHIVED);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Soft-delete a schedule.' })
  @ApiOkResponse({ type: DeletedResponseDto })
  remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.schedules.remove(companyId, user, id);
  }

  @Post(':id/targets')
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Add a target (SCREEN/SCREEN_GROUP/LOCATION/COMPANY).' })
  @ApiCreatedResponse({ type: ScheduleDto })
  addTarget(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddScheduleTargetDto,
  ) {
    return this.schedules.addTarget(companyId, user, id, dto);
  }

  @Delete(':id/targets/:targetId')
  @RequirePermissions(Permission.ScheduleManage)
  @ApiOperation({ summary: 'Remove a target.' })
  @ApiOkResponse({ type: ScheduleDto })
  removeTarget(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('targetId') targetId: string,
  ) {
    return this.schedules.removeTarget(companyId, user, id, targetId);
  }
}
