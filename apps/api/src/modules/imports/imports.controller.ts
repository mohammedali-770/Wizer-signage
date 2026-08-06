import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportType } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ListImportsQueryDto } from './dto/import.dto';
import { ApiPaginatedResponse } from '../../common/dto/api-response.dto';
import { ImportCommitResultDto, ImportJobDetailDto, ImportJobDto } from './dto/import-response.dto';
import { ImportService } from './import.service';

// 15 MB cap on import uploads.
const IMPORT_LIMIT = { limits: { fileSize: 15 * 1024 * 1024 } };

/**
 * Bulk import API (Phase 10). All routes require `import:run` (Company Admin;
 * Super Admin implicitly). The service enforces type-level scoping (COMPANY
 * imports are Super Admin only) and tenant safety (companyId from the token,
 * never the file).
 */
@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  private scope(user: AuthenticatedUser) {
    return { companyId: user.companyId, isSuperAdmin: user.isSuperAdmin };
  }

  private parseType(type: string): ImportType {
    const upper = type.toUpperCase() as ImportType;
    if (!Object.values(ImportType).includes(upper))
      throw new BadRequestException(`Unknown import type "${type}".`);
    return upper;
  }

  @Get('templates/:type')
  @RequirePermissions(Permission.ImportRun)
  @ApiOperation({ summary: 'Download a CSV template for an import type.' })
  // Streams a CSV. No JSON body exists to document — the response is the file.
  @ApiOkResponse({
    description: 'A CSV template with the expected header row.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  template(@Param('type') type: string, @Res({ passthrough: true }) res: Response) {
    const importType = this.parseType(type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${importType.toLowerCase()}-template.csv"`,
    );
    return this.imports.template(importType);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(Permission.ImportRun)
  @UseInterceptors(FileInterceptor('file', IMPORT_LIMIT))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload + validate a CSV/XLSX import (?type=). Returns a preview job.' })
  @ApiOkResponse({ type: ImportJobDto })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.imports.upload(this.scope(user), user, this.parseType(type), file);
  }

  @Get()
  @RequirePermissions(Permission.ImportRun)
  @ApiOperation({ summary: 'Import history.' })
  @ApiPaginatedResponse(ImportJobDto)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListImportsQueryDto) {
    return this.imports.list(this.scope(user), query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ImportRun)
  @ApiOperation({ summary: 'One import job, including the rows awaiting commit.' })
  @ApiOkResponse({ type: ImportJobDetailDto })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.imports.get(this.scope(user), id);
  }

  @Post(':id/commit')
  @HttpCode(200)
  @RequirePermissions(Permission.ImportRun)
  @ApiOperation({
    summary:
      'Commit a validated import (creates the rows, reusing entity validation + plan limits).',
  })
  @ApiOkResponse({ type: ImportCommitResultDto })
  commit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.imports.commit(this.scope(user), user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.ImportRun)
  @ApiOperation({ summary: 'Cancel an uncommitted import.' })
  @ApiOkResponse({ type: ImportJobDto })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.imports.cancel(this.scope(user), user, id);
  }
}
