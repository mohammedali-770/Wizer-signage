import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { LocationStatus } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse, DeletedResponseDto } from '../../common/dto/api-response.dto';
import { LocationDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateLocationDto, ListLocationsQueryDto, UpdateLocationDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post()
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Create a location/branch.' })
  @ApiCreatedResponse({ type: LocationDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(companyId, user, dto);
  }

  @Get()
  @RequirePermissions(Permission.LocationRead)
  @ApiOperation({ summary: 'List locations (company-scoped).' })
  @ApiPaginatedResponse(LocationDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListLocationsQueryDto) {
    return this.locations.list(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.LocationRead)
  @ApiOperation({ summary: 'Location detail with screen metrics.' })
  @ApiOkResponse({ type: LocationDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.locations.getDetail(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Update a location.' })
  @ApiOkResponse({ type: LocationDto })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(companyId, user, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Archive a location.' })
  @ApiOkResponse({ type: LocationDto })
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.locations.setStatus(companyId, user, id, LocationStatus.ARCHIVED);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Deactivate a location.' })
  @ApiOkResponse({ type: LocationDto })
  deactivate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.locations.setStatus(companyId, user, id, LocationStatus.INACTIVE);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Reactivate a location.' })
  @ApiOkResponse({ type: LocationDto })
  reactivate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.locations.setStatus(companyId, user, id, LocationStatus.ACTIVE);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.LocationManage)
  @ApiOperation({ summary: 'Delete (soft) a location; its screens are unassigned.' })
  @ApiOkResponse({ type: DeletedResponseDto })
  async remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.locations.remove(companyId, user, id);
    return { deleted: true };
  }
}
