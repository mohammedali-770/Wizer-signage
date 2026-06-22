import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { InviteSuperAdminDto, ListSuperAdminsQueryDto } from './dto/super-admin.dto';
import { SuperAdminService } from './super-admin.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly superAdmin: SuperAdminService) {}

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
}
