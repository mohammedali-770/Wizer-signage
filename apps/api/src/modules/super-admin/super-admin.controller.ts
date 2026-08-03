import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, type RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ImpersonationService } from './impersonation.service';
import { StartImpersonationDto } from './dto/impersonation.dto';
import {
  InviteSuperAdminDto,
  ListDemoRequestsQueryDto,
  ListSuperAdminsQueryDto,
  UpdateDemoRequestDto,
} from './dto/super-admin.dto';
import { SuperAdminService } from './super-admin.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('super-admin')
export class SuperAdminController {
  constructor(
    private readonly superAdmin: SuperAdminService,
    private readonly impersonation: ImpersonationService,
  ) {}

  // --- Impersonation ------------------------------------------------------

  @Post('impersonation')
  @HttpCode(200)
  // Each attempt burns a second factor and is logged whether it succeeds or
  // not; a rate this low makes a code-guessing loop pointless and keeps the
  // audit trail readable.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Start an audited impersonation of a company (requires a fresh 2FA code and a reason). ' +
      'Returns a short-lived, non-refreshable access token.',
  })
  startImpersonation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartImpersonationDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.impersonation.start(user, dto, meta);
  }

  @Delete('impersonation')
  @ApiOperation({ summary: 'End the impersonation this token belongs to.' })
  endImpersonation(@CurrentUser() user: AuthenticatedUser, @ReqMeta() meta: RequestMeta) {
    return this.impersonation.end(user, meta);
  }

  @Get('impersonation/active')
  @ApiOperation({ summary: 'Every impersonation session that is live right now.' })
  listActiveImpersonations() {
    return this.impersonation.listActive();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Platform overview counters.' })
  overview() {
    return this.superAdmin.getOverview();
  }

  @Get('admins')
  @ApiOperation({ summary: 'List Super Admin accounts.' })
  listAdmins(@Query() query: ListSuperAdminsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdmin.listSuperAdmins(user, query);
  }

  @Post('admins/invite')
  @ApiOperation({ summary: 'Invite a new Super Admin.' })
  invite(@Body() dto: InviteSuperAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdmin.invite(user, dto);
  }

  @Post('admins/:id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a Super Admin account.' })
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdmin.setStatus(user, id, true);
  }

  @Post('admins/:id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a Super Admin (last active one is protected).' })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.superAdmin.setStatus(user, id, false);
  }

  @Get('demo-requests')
  @ApiOperation({ summary: 'List marketing-site demo requests.' })
  listDemoRequests(@Query() query: ListDemoRequestsQueryDto) {
    return this.superAdmin.listDemoRequests(query);
  }

  @Patch('demo-requests/:id')
  @ApiOperation({ summary: 'Update a demo request status.' })
  updateDemoRequest(
    @Param('id') id: string,
    @Body() dto: UpdateDemoRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.superAdmin.updateDemoRequestStatus(user, id, dto);
  }
}
