import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { PlanDto } from './dto/billing-response.dto';
import { CreatePlanDto, ListPlansQueryDto, UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @ApiOperation({ summary: 'Create a plan (Super Admin).' })
  @ApiCreatedResponse({ type: PlanDto })
  create(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List plans.' })
  @ApiPaginatedResponse(PlanDto)
  list(@Query() query: ListPlansQueryDto) {
    return this.plans.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a plan by id.' })
  @ApiOkResponse({ type: PlanDto })
  get(@Param('id') id: string) {
    return this.plans.getByIdOrThrow(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a plan.' })
  @ApiOkResponse({ type: PlanDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.update(user, id, dto);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive (deactivate) a plan.' })
  // A bare @Post: 201, not 200.
  @ApiCreatedResponse({ type: PlanDto })
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.setActive(user, id, false);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Re-activate a plan.' })
  @ApiCreatedResponse({ type: PlanDto })
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.setActive(user, id, true);
  }
}
