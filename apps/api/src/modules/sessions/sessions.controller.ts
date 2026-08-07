import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { RevokedCountDto, RevokedFlagDto, SessionDto } from './dto/session-response.dto';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @RequirePermissions(Permission.SessionReadOwn)
  @ApiOperation({ summary: "List the current user's active sessions." })
  // A bare array, not the pagination envelope — every live session, no paging.
  @ApiOkResponse({ type: [SessionDto] })
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.listActiveForUser(user.userId, user.sessionId);
  }

  @Delete('others')
  @HttpCode(200)
  @RequirePermissions(Permission.SessionTerminateOwn)
  @ApiOperation({ summary: 'Sign out of all other sessions (keep the current one).' })
  @ApiOkResponse({ type: RevokedCountDto })
  async revokeOthers(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.sessions.revokeAllForUser(
      user.userId,
      'user_revoked_others',
      user.sessionId,
    );
    return { revokedCount: count };
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.SessionTerminateOwn)
  @ApiOperation({ summary: 'Revoke one of the current user’s sessions.' })
  // RevokedFlagDto, not RevokedCountDto. The two now differ by NAME as well as
  // type — `revokedCount` for the bulk routes, `revoked` for this one — so a
  // client cannot read one as the other and be quietly wrong.
  @ApiOkResponse({ type: RevokedFlagDto })
  async revokeOwn(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.sessions.revokeOwn(user.userId, id);
    return { revoked: true };
  }

  @Post('users/:userId/terminate')
  @HttpCode(200)
  @RequirePermissions(Permission.SessionManage)
  @ApiOperation({ summary: "Admin: terminate all of a user's sessions (force sign-out)." })
  @ApiOkResponse({ type: RevokedCountDto })
  async terminateUser(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    const count = await this.sessions.terminateUserSessions(
      { companyId: user.companyId, isSuperAdmin: user.isSuperAdmin },
      userId,
    );
    return { revokedCount: count };
  }
}
