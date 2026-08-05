import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiPaginatedResponse, PurgedResponseDto } from '../../common/dto/api-response.dto';
import { ContentDto } from '../../common/dto/entity-response.dto';

import { CurrentCompany } from '../../common/decorators/current-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { diskUploadOptions } from '../../common/upload/disk-upload';
import { ManifestRefreshInterceptor } from '../sync/manifest-refresh.interceptor';
import { ContentCleanupService } from './content-cleanup.service';
import { ContentService } from './content.service';
import {
  BulkContentDto,
  BulkContentTagDto,
  CreateTextContentDto,
  CreateUrlContentDto,
  ListContentQueryDto,
  UpdateContentDto,
  UploadContentDto,
} from './dto/content.dto';

// 300 MB hard cap on multipart uploads (plan max-file-size enforced after).
// Spooled to disk, not the heap — a 300 MB memoryStorage upload is held in RAM
// for the client's entire upload duration; see common/upload/disk-upload.ts.
const UPLOAD_LIMIT = diskUploadOptions(300 * 1024 * 1024);

@ApiTags('content')
@ApiBearerAuth()
@Controller('content')
@UseInterceptors(ManifestRefreshInterceptor)
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly cleanup: ContentCleanupService,
  ) {}

  @Post('upload')
  @RequirePermissions(Permission.ContentManage)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMIT))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload image/video/PDF content.' })
  @ApiCreatedResponse({ type: ContentDto })
  upload(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadContentDto,
  ) {
    return this.content.upload(companyId, user, file, dto);
  }

  @Post('url')
  @RequirePermissions(Permission.ContentManage)
  @ApiOperation({ summary: 'Create URL content.' })
  @ApiCreatedResponse({ type: ContentDto })
  createUrl(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUrlContentDto,
  ) {
    return this.content.createUrl(companyId, user, dto);
  }

  @Post('text')
  @RequirePermissions(Permission.ContentManage)
  @ApiOperation({ summary: 'Create a text announcement.' })
  @ApiCreatedResponse({ type: ContentDto })
  createText(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTextContentDto,
  ) {
    return this.content.createText(companyId, user, dto);
  }

  @Get()
  @RequirePermissions(Permission.ContentRead)
  @ApiOperation({
    summary: 'List content (filter by type/status/orientation/tag/expiry; sortable).',
  })
  @ApiPaginatedResponse(ContentDto)
  list(@CurrentCompany() companyId: string, @Query() query: ListContentQueryDto) {
    return this.content.list(companyId, query);
  }

  @Get('usage')
  @RequirePermissions(Permission.ContentRead)
  @ApiOperation({ summary: 'Storage usage + content counts for the library.' })
  usage(@CurrentCompany() companyId: string) {
    return this.content.usageSummary(companyId);
  }

  @Post('bulk/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  bulkArchive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkContentDto,
  ) {
    return this.content.bulkLifecycle(companyId, user, dto.contentIds, 'archive');
  }

  @Post('bulk/unarchive')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  bulkUnarchive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkContentDto,
  ) {
    return this.content.bulkLifecycle(companyId, user, dto.contentIds, 'unarchive');
  }

  @Post('bulk/trash')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  bulkTrash(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkContentDto,
  ) {
    return this.content.bulkLifecycle(companyId, user, dto.contentIds, 'trash');
  }

  @Post('bulk/restore')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  bulkRestore(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkContentDto,
  ) {
    return this.content.bulkLifecycle(companyId, user, dto.contentIds, 'restore');
  }

  @Post('bulk/tags')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  bulkTags(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkContentTagDto,
  ) {
    return this.content.bulkTag(companyId, user, dto);
  }

  @Post('trash/purge')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  @ApiOperation({ summary: 'Permanently remove this company’s trash older than 14 days.' })
  @ApiOkResponse({ type: PurgedResponseDto })
  async purge(@CurrentCompany() companyId: string) {
    const purged = await this.cleanup.purgeExpiredTrash(companyId);
    return { purged };
  }

  @Get(':id')
  @RequirePermissions(Permission.ContentRead)
  @ApiOperation({ summary: 'Content detail.' })
  @ApiOkResponse({ type: ContentDto })
  detail(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.content.getDetail(companyId, id);
  }

  @Get(':id/preview')
  @RequirePermissions(Permission.ContentRead)
  @ApiOperation({ summary: 'A signed preview URL (files) or the URL/text payload.' })
  preview(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.content.preview(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ContentManage)
  @ApiOperation({
    summary: 'Update content metadata (title/description/orientation/expiry/tags/...).',
  })
  @ApiOkResponse({ type: ContentDto })
  update(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.content.update(companyId, user, id, dto);
  }

  @Post(':id/replace')
  @RequirePermissions(Permission.ContentManage)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMIT))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace the uploaded file (same type).' })
  @ApiCreatedResponse({ type: ContentDto })
  replace(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.content.replaceFile(companyId, user, id, file);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  archive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.content.setLifecycle(companyId, user, id, 'archive');
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  unarchive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.content.setLifecycle(companyId, user, id, 'unarchive');
  }

  @Post(':id/trash')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  trash(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.content.setLifecycle(companyId, user, id, 'trash');
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(Permission.ContentManage)
  restore(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.content.setLifecycle(companyId, user, id, 'restore');
  }
}
