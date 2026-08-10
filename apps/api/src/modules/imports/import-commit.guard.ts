import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Marker written atomically before an import commit starts. ImportStatus has no
 * PROCESSING value, so FAILED is deliberately used as the fail-closed state:
 * the existing ImportService accepts it for the claimed request and overwrites
 * it with the real terminal status when the run completes. If the worker dies,
 * the job stays non-retryable instead of silently replaying already-created
 * rows. The operator can cancel a stale claim after STALE_CLAIM_MS and upload a
 * fresh import after inspecting any partial results.
 */
export const IMPORT_COMMIT_CLAIM_CODE = 'COMMIT_IN_PROGRESS';
export const IMPORT_COMMIT_STALE_MS = 2 * 60 * 60 * 1000;

const claimJson = JSON.stringify([
  {
    line: 0,
    code: IMPORT_COMMIT_CLAIM_CODE,
    errors: [
      'Import commit is in progress. If the worker is interrupted, inspect partial results before uploading a replacement import.',
    ],
  },
]);

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
          SET "status" = 'FAILED', "errors" = ${claimJson}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id} AND "status" = 'VALIDATED'
        `
      : await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'FAILED', "errors" = ${claimJson}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "companyId" = ${user.companyId}
            AND "status" = 'VALIDATED'
        `;

    if (claimed !== 1) {
      throw new BadRequestException(
        'This import is already being committed, was already committed/cancelled, or is not eligible for commit.',
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

    const marker = JSON.stringify([{ code: IMPORT_COMMIT_CLAIM_CODE }]);
    const staleBefore = new Date(Date.now() - IMPORT_COMMIT_STALE_MS);
    const cancelled = user.isSuperAdmin
      ? await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "status" IN ('UPLOADED', 'VALIDATED', 'FAILED')
            AND (NOT ("errors" @> ${marker}::jsonb) OR "updatedAt" < ${staleBefore})
        `
      : await this.prisma.$executeRaw`
          UPDATE "import_jobs"
          SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}
            AND "companyId" = ${user.companyId}
            AND "status" IN ('UPLOADED', 'VALIDATED', 'FAILED')
            AND (NOT ("errors" @> ${marker}::jsonb) OR "updatedAt" < ${staleBefore})
        `;

    if (cancelled !== 1) {
      throw new BadRequestException(
        'This import cannot be cancelled because it is committed or a commit is currently in progress.',
      );
    }
    return true;
  }
}
