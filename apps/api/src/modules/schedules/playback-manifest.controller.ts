import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { ManifestQueryDto } from './dto/schedule.dto';
import { PlaybackManifestDto } from './dto/playback-manifest-response.dto';
import { ScheduleResolverService } from './schedule-resolver.service';

/**
 * The playback manifest a screen is playing from, as an OPERATOR sees it.
 *
 * This is the dashboard-facing view of the same resolution the Android player
 * consumes over its own device-authenticated route, `GET /device/manifest` —
 * both call `ScheduleResolverService`, so what is previewed here is what a
 * screen plays. The two differ only in authentication and audience, which is
 * why this one sits under the screen resource behind a bearer token and a
 * ScreenRead permission.
 *
 * Read-only; uses signed URLs for stored files (no public URLs).
 */
@ApiTags('playback')
@ApiBearerAuth()
@Controller('screens')
export class PlaybackManifestController {
  constructor(private readonly resolver: ScheduleResolverService) {}

  @Get(':id/playback-manifest')
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'Resolve what a screen should play now (or at ?at=ISO).' })
  // The shape the golden fixtures in contracts/ already pin for the player.
  @ApiOkResponse({ type: PlaybackManifestDto })
  manifest(
    @CurrentCompany() companyId: string,
    @Param('id') id: string,
    @Query() query: ManifestQueryDto,
  ) {
    const at = query.at ? new Date(query.at) : new Date();
    return this.resolver.resolve(companyId, id, at);
  }
}
