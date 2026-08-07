import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import { ManifestQueryDto } from './dto/schedule.dto';
import { PlaybackManifestDto } from './dto/playback-manifest-response.dto';
import { ScheduleResolverService } from './schedule-resolver.service';

/**
 * The forward-looking playback manifest a screen (Android player, Phase 6/7)
 * will consume. Exposed under the screen resource. Read-only; uses signed URLs
 * for stored files (no public URLs).
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
