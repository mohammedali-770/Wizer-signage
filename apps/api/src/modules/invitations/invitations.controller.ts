import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { InvitationCreatedDto, InvitationDto } from '../../common/dto/entity-response.dto';
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
  // ...CreatedDto: create returns the RAW token alongside the row, so the
  // inviter can build the accept link when email is not configured.
  @ApiCreatedResponse({ type: InvitationCreatedDto })
  create(@Body() dto: CreateInvitationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.create(user, dto);
  }

  @Get()
  @RequirePermissions(Permission.UserRead)
  @ApiOperation({ summary: 'List invitations (tenant-scoped).' })
  // The plain DTO: the list never carries a token.
  @ApiPaginatedResponse(InvitationDto)
  list(@Query() query: ListInvitationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.list(user, query);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: 'Resend an invitation (new token + expiry).' })
  // Mints a NEW token and returns it, same as create.
  @ApiOkResponse({ type: InvitationCreatedDto })
  resend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.resend(user, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.UserInvite)
  @ApiOperation({ summary: 'Revoke a pending invitation.' })
  @ApiOkResponse({ type: InvitationDto })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitations.revoke(user, id);
  }
}
