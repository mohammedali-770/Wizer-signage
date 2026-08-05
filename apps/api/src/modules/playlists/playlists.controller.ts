import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse, SuccessResponseDto } from '../../common/dto/api-response.dto';
import { PlaylistDetailDto, PlaylistSummaryDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ManifestRefreshInterceptor } from '../sync/manifest-refresh.interceptor';
import {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  DuplicatePlaylistDto,
  ListPlaylistsQueryDto,
  ReorderPlaylistItemsDto,
  UpdatePlaylistDto,
  UpdatePlaylistItemDto,
} from './dto/playlist.dto';
import { PlaylistsService } from './playlists.service';

@ApiTags('playlists')
@ApiBearerAuth()
@Controller('playlists')
@UseInterceptors(ManifestRefreshInterceptor)
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  @RequirePermissions(Permission.PlaylistRead)
  @ApiOperation({ summary: 'List playlists (filter by status/search/created date).' })
  @ApiPaginatedResponse(PlaylistSummaryDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListPlaylistsQueryDto) {
    return this.playlists.list(companyId, query);
  }

  @Post()
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Create a playlist (optionally with initial items).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePlaylistDto,
  ) {
    return this.playlists.create(companyId, user, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.PlaylistRead)
  @ApiOperation({ summary: 'Playlist detail with items + validity.' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.playlists.getDetail(companyId, id);
  }

  @Get(':id/validate')
  @RequirePermissions(Permission.PlaylistRead)
  @ApiOperation({
    summary: 'Validation summary (schedulable, invalid items, orientation, duration).',
  })
  validate(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.playlists.validate(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Update playlist metadata (title/description/status).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlists.update(companyId, user, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.PlaylistManage)
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.playlists.setArchived(companyId, user, id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions(Permission.PlaylistManage)
  unarchive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.playlists.setArchived(companyId, user, id, false);
  }

  @Post(':id/duplicate')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Duplicate a playlist (copies all items).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  duplicate(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DuplicatePlaylistDto,
  ) {
    return this.playlists.duplicate(companyId, user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Soft-delete a playlist.' })
  @ApiOkResponse({ type: SuccessResponseDto })
  remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.playlists.remove(companyId, user, id);
  }

  // --- Items (reorder declared before :itemId so it is not shadowed) -------

  @Post(':id/items')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Add an item (ACTIVE, non-expired, same-company content).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  addItem(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPlaylistItemDto,
  ) {
    return this.playlists.addItem(companyId, user, id, dto);
  }

  @Patch(':id/items/reorder')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Reorder items (full ordered list of item ids).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  reorder(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReorderPlaylistItemsDto,
  ) {
    return this.playlists.reorderItems(companyId, user, id, dto);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Update an item (duration / playFullVideo / PDF page duration).' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  updateItem(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePlaylistItemDto,
  ) {
    return this.playlists.updateItem(companyId, user, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(Permission.PlaylistManage)
  @ApiOperation({ summary: 'Remove an item.' })
  @ApiOkResponse({ type: PlaylistDetailDto })
  removeItem(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.playlists.removeItem(companyId, user, id, itemId);
  }
}
