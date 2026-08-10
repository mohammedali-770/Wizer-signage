import { Injectable, Logger } from '@nestjs/common';
import { ImportStatus, UserRole, UserStatus } from '@prisma/client';

import { hasPermission, Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IMPORT_COMMIT_QUEUED_CODE,
  IMPORT_COMMIT_WORKING_CODE,
} from '../imports/import-commit.guard';
import { ImportService } from '../imports/import.service';

const IMPORT_WORKER_BATCH = 20;

function marker(code: string, message: string): string {
  return JSON.stringify([{ line: 0, code, errors: [message] }]);
}

const queuedMarker = JSON.stringify([{ code: IMPORT_COMMIT_QUEUED_CODE }]);
const workingMarker = marker(
  IMPORT_COMMIT_WORKING_CODE,
  'Import commit is being processed by the maintenance worker.',
);

@Injectable()
export class ImportCommitWorkerService {
  private readonly logger = new Logger(ImportCommitWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: ImportService,
  ) {}

  async run(): Promise<{ claimed: number; completed: number; failed: number }> {
    const queued = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "import_jobs"
      WHERE "status" = 'UPLOADED'
        AND "errors" @> ${queuedMarker}::jsonb
      ORDER BY "updatedAt" ASC, "id" ASC
      LIMIT ${IMPORT_WORKER_BATCH}
    `;

    let claimed = 0;
    let completed = 0;
    let failed = 0;

    for (const { id } of queued) {
      const owns = await this.prisma.$executeRaw`
        UPDATE "import_jobs"
        SET "errors" = ${workingMarker}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}
          AND "status" = 'UPLOADED'
          AND "errors" @> ${queuedMarker}::jsonb
      `;
      if (owns !== 1) continue;
      claimed++;

      try {
        const job = await this.prisma.importJob.findUnique({
          where: { id },
          select: { id: true, companyId: true, createdById: true },
        });
        if (!job?.createdById) throw new Error('Import creator is missing.');

        const creator = await this.prisma.user.findUnique({
          where: { id: job.createdById },
          select: {
            id: true,
            email: true,
            role: true,
            companyId: true,
            status: true,
            deletedAt: true,
          },
        });
        if (!creator || creator.deletedAt || creator.status !== UserStatus.ACTIVE) {
          throw new Error('Import creator is no longer an active user.');
        }
        if (!hasPermission(creator.role, Permission.ImportRun)) {
          throw new Error('Import creator no longer has permission to run imports.');
        }

        const isSuperAdmin = creator.role === UserRole.SUPER_ADMIN;
        if (!isSuperAdmin && creator.companyId !== job.companyId) {
          throw new Error('Import creator no longer belongs to the owning company.');
        }

        const actor: AuthenticatedUser = {
          userId: creator.id,
          email: creator.email,
          role: creator.role,
          companyId: job.companyId,
          sessionId: `maintenance:import:${job.id}`,
          isSuperAdmin,
          mfaSatisfied: true,
          twoFactorRequired: false,
        };

        const result = await this.imports.commit(
          { companyId: job.companyId, isSuperAdmin },
          actor,
          job.id,
        );
        if (result.status === ImportStatus.COMMITTED) completed++;
        else failed++;
      } catch (error) {
        failed++;
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(`Queued import ${id} failed: ${detail}`);
        await this.prisma.importJob
          .update({
            where: { id },
            data: {
              status: ImportStatus.FAILED,
              errors: [
                {
                  line: 0,
                  errors: [
                    'The background import failed. Inspect server logs and existing rows before uploading a replacement file.',
                  ],
                },
              ],
            },
          })
          .catch((persistError) =>
            this.logger.error(
              `Could not persist failed state for import ${id}: ${
                persistError instanceof Error ? persistError.message : String(persistError)
              }`,
            ),
          );
      }
    }

    return { claimed, completed, failed };
  }
}
