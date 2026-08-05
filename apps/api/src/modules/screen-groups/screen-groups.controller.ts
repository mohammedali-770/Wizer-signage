import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { ScreenGroupDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateScreenGroupDto,
  GroupScreensDto,
  ListScreenGroupsQueryDto,
  UpdateScreenGroupDto,
} from './dto/screen-group.dto';
import { ScreenGroupsService } from './screen-groups.service';

@ApiTags('screen-groups')
@ApiBearerAuth()
@Controller('screen-groups')
export class ScreenGroupsController {
  constructor(private readonly groups: ScreenGroupsService) {}

  @Post()
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Create a screen group.' })
  @ApiOkResponse({ type: ScreenGroupDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScreenGroupDto,
  ) {
    return this.groups.create(companyId, user, dto);
  }

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'List screen groups (with member counts).' })
  @ApiPaginatedResponse(ScreenGroupDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListScreenGroupsQueryDto) {
    return this.groups.list(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Group detail with member screens.' })
  @ApiOkResponse({ type: ScreenGroupDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.groups.getDetail(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ScreenManage)
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScreenGroupDto,
  ) {
    return this.groups.update(companyId, user, id, dto);
  }

  @Post(':id/screens')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Add screens to a group.' })
  @ApiOkResponse({ type: ScreenGroupDto })
  addScreens(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GroupScreensDto,
  ) {
    return this.groups.addScreens(companyId, user, id, dto.screenIds);
  }

  @Delete(':id/screens')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Remove screens from a group.' })
  @ApiOkResponse({ type: ScreenGroupDto })
  removeScreens(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GroupScreensDto,
  ) {
    return this.groups.removeScreens(companyId, user, id, dto.screenIds);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  async remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.groups.remove(companyId, user, id);
    return { deleted: true };
  }
}
