import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import {
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a subscription for a company (Super Admin).' })
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions.' })
  list(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription by id.' })
  get(@Param('id') id: string) {
    return this.subscriptions.getByIdOrThrow(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Subscription change history (from the audit trail).' })
  async history(@Param('id') id: string) {
    const subscription = await this.subscriptions.getByIdOrThrow(id);
    return this.subscriptions.history(subscription.companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subscription (change plan, status, dates).' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.update(user, id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription.' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.cancel(user, id);
  }
}
