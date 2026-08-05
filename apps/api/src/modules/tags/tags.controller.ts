import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { TagDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@ApiTags('tags')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Post()
  @RequirePermissions(Permission.ScreenManage)
  @ApiOperation({ summary: 'Create a tag (company-scoped).' })
  @ApiOkResponse({ type: TagDto })
  create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTagDto,
  ) {
    return this.tags.create(companyId, user, dto);
  }

  @Get()
  @RequirePermissions(Permission.ScreenRead)
  @ApiOperation({ summary: 'List tags (filter by type).' })
  @ApiPaginatedResponse(TagDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListTagsQueryDto) {
    return this.tags.list(companyId, query);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ScreenManage)
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tags.update(companyId, user, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(Permission.ScreenManage)
  async remove(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.tags.remove(companyId, user, id);
    return { deleted: true };
  }
}
