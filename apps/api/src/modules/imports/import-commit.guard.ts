import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ImportStatus.UPLOADED is otherwise unused after validation, so it is the
 * fail-closed queue state without adding a Prisma enum migration this late in
 * the release. The JSON marker distinguishes a queued/working commit from a
 * genuinely pre-validation row. The maintenance worker atomically changes the
 * marker from QUEUED -> WORKING before calling ImportService.commit().
 */
export const IMPORT_COMMIT_QUEUED_CODE = 'COMMIT_QUEUED';
export const IMPORT_COMMIT_WORKING_CODE = 'COMMIT_IN_PROGRESS';
export const IMPORT_COMMIT_STALE_MS = 2 * 60 * 60 * 1000;

function markerJson(code: string, message: string): string {
  return JSON.stringify([{ line: 0, code, errors: [message] }]);
}

const queuedJson = markerJson(
  IMPORT_COMMIT_QUEUED_CODE,
  'Import commit is queued for the maintenance worker.',
);

interface ImportRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class ImportCommitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    const user = request.user;
    const id = request.params?.id;
    if (!user || !id) throw new BadRequestException('Import context is missing.');

    const claimed = user.isSuperAdmin
      ? await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'UPLOADED', "errors" = ${queuedJson}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id} AND "status" = 'VALIDATED'
        `
      : await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'UPLOADED', "errors" = ${queuedJson}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "companyId" = ${user.companyId}
            AND "status" = 'VALIDATED'
        `;

    if (claimed !== 1) {
      throw new BadRequestException(
        'This import is already queued/committed/cancelled, or is not eligible for commit.',
      );
    }
    return true;
  }
}

@Injectable()
export class ImportCancelGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    const user = request.user;
    const id = request.params?.id;
    if (!user || !id) throw new BadRequestException('Import context is missing.');

    const queuedMarker = JSON.stringify([{ code: IMPORT_COMMIT_QUEUED_CODE }]);
    const workingMarker = JSON.stringify([{ code: IMPORT_COMMIT_WORKING_CODE }]);
    const staleBefore = new Date(Date.now() - IMPORT_COMMIT_STALE_MS);
    const cancelled = user.isSuperAdmin
      ? await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "status" IN ('UPLOADED', 'VALIDATED', 'FAILED')
            AND (
              (NOT ("errors" @> ${queuedMarker}::jsonb) AND NOT ("errors" @> ${workingMarker}::jsonb))
              OR "updatedAt" < ${staleBefore}
            )
        `
      : await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "companyId" = ${user.companyId}
            AND "status" IN ('UPLOADED', 'VALIDATED', 'FAILED')
            AND (
              (NOT ("errors" @> ${queuedMarker}::jsonb) AND NOT ("errors" @> ${workingMarker}::jsonb))
              OR "updatedAt" < ${staleBefore}
            )
        `;

    if (cancelled !== 1) {
      throw new BadRequestException(
        'This import cannot be cancelled because it is committed or a commit is currently queued/running.',
      );
    }
    return true;
  }
}
