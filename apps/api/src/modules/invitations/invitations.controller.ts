import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: 'Invite a user by email (3-day expiry).' })
  create(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.create(user, dto);
  }

  @Get()
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: 'List invitations (tenant-scoped).' })
  list(@Query() query: ListInvitationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.list(user, query);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: 'Resend an invitation (new token + expiry).' })
  resend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.resend(user, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: 'Revoke a pending invitation.' })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.revoke(user, id);
  }
}
