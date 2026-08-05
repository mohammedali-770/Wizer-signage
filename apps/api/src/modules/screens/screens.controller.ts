import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ScreenStatus } from '@prisma/client';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse, SuccessResponseDto } from '../../common/dto/api-response.dto';
import { ScreenDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  AssignGroupsDto,
  AssignTagsDto,
  BulkScreenGroupDto,
  BulkScreenTagDto,
  CreateScreenDto,
  ListScreensQueryDto,
  MoveScreenDto,
  SetKioskPinDto,
  UpdateScreenDto,
} from './dto/screen.dto';
import { ScreensService } from './screens.service';

@ApiTags('screens')
@ApiBearerAuth()
@Controller('screens')
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}

  @Post()
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Create a screen profile.' })
  @ApiOkResponse({ type: ScreenDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScreenDto,
  ) {
    return this.screens.create(companyId, user, dto);
  }

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'List screens (filter by location/status/orientation/use/tag/group).' })
  @ApiPaginatedResponse(ScreenDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListScreensQueryDto) {
    return this.screens.list(companyId, query);
  }

  @Post('bulk/tags')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Bulk add/remove a tag across screens.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  bulkTags(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkScreenTagDto,
  ) {
    return this.screens.bulkTag(companyId, user, dto);
  }

  @Post('bulk/groups')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Bulk add/remove screens to a group.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  bulkGroups(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkScreenGroupDto,
  ) {
    return this.screens.bulkGroup(companyId, user, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Screen detail (with monitoring placeholders).' })
  @ApiOkResponse({ type: ScreenDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.screens.getDetail(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Update screen fields (incl. audio/working-hours/kiosk).' })
  @ApiOkResponse({ type: ScreenDto })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScreenDto,
  ) {
    return this.screens.update(companyId, user, id, dto);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Move a screen to another location (or unassign).' })
  @ApiOkResponse({ type: ScreenDto })
  move(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MoveScreenDto,
  ) {
    return this.screens.move(companyId, user, id, dto.locationId);
  }

  @Put(':id/tags')
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Replace a screen’s tags.' })
  @ApiOkResponse({ type: ScreenDto })
  tags(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignTagsDto,
  ) {
    return this.screens.assignTags(companyId, user, id, dto.tagIds);
  }

  @Put(':id/groups')
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Replace a screen’s group memberships.' })
  @ApiOkResponse({ type: ScreenDto })
  groups(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignGroupsDto,
  ) {
    return this.screens.assignGroups(companyId, user, id, dto.groupIds);
  }

  @Put(':id/kiosk-pin')
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Set the screen kiosk exit PIN (stored hashed).' })
  @ApiOkResponse({ type: SuccessResponseDto })
  setKioskPin(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetKioskPinDto,
  ) {
    return this.screens.setKioskPin(companyId, user, id, dto.pin);
  }

  @Delete(':id/kiosk-pin')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Clear the screen kiosk exit PIN.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  resetKioskPin(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.screens.resetKioskPin(companyId, user, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.screens.setStatus(companyId, user, id, ScreenStatus.ARCHIVED);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  disable(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.screens.setStatus(companyId, user, id, ScreenStatus.DISABLED);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  reactivate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.screens.setStatus(companyId, user, id, ScreenStatus.UNPAIRED);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  async remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.screens.remove(companyId, user, id);
    return { deleted: true };
  }
}
