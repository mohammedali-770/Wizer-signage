import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { CompanyDto } from '../../common/dto/entity-response.dto';
import { UsageEvaluationDto } from '../usage-limits/dto/usage-response.dto';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CompaniesService } from './companies.service';
import {
  CreateCompanyDto,
  ListCompaniesQueryDto,
  SuspendCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // --- Any authenticated company user ------------------------------------

  @Get('me')
  @RequirePermissions(Permission.CompanyRead)
  @ApiOperation({ summary: "Get the current user's company." })
  @ApiOkResponse({ type: CompanyDto })
  myCompany(@CurrentUser() user: AuthenticatedUser) {
    return this.companies.getForPrincipal(user.companyId);
  }

  // --- Super Admin (platform) --------------------------------------------

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a company (Super Admin).' })
  @ApiCreatedResponse({ type: CompanyDto })
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.companies.create(user, dto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List companies (search/filter/sort).' })
  @ApiPaginatedResponse(CompanyDto)
  list(@Query() query: ListCompaniesQueryDto) {
    return this.companies.list(query);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Company detail with metrics, subscription, and plan.' })
  @ApiOkResponse({ type: CompanyDto })
  detail(@Param('id') id: string) {
    return this.companies.getDetail(id);
  }

  @Get(':id/usage')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Company usage vs plan limits (with grace status).' })
  @ApiOkResponse({ type: UsageEvaluationDto })
  usage(@Param('id') id: string) {
    return this.companies.getUsage(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update company details.' })
  @ApiOkResponse({ type: CompanyDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companies.update(user, id, dto);
  }

  @Post(':id/suspend')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Suspend a company (blocks its users; data preserved).' })
  @ApiCreatedResponse({ type: CompanyDto })
  suspend(
    @Param('id') id: string,
    @Body() dto: SuspendCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.companies.suspend(user, id, dto.reason);
  }

  @Post(':id/reactivate')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reactivate a suspended company.' })
  @ApiCreatedResponse({ type: CompanyDto })
  reactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.companies.reactivate(user, id);
  }
}
