import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { BackupService } from './backup.service';
import { RecordBackupDto, RunMaintenanceDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

/**
 * Platform maintenance + backup status (Phase 10). Super Admin only. The cron
 * runner uses the maintenance CLI; these endpoints are for the dashboard
 * (backup health) and manual on-demand triggers.
 */
@ApiTags('admin-maintenance')
@ApiBearerAuth()
@Roles(UserRole.SUPER_ADMIN)
@Controller('admin')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly backup: BackupService,
    private readonly activityLog: ActivityLogService,
  ) {}

  @Get('backups')
  @ApiOperation({
    summary: 'Backup health: last successful database backup, staleness, recent runs.',
  })
  backups() {
    return this.backup.status();
  }

  @Post('backups')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record a backup run result (used by the backup script / integrations).',
  })
  async recordBackup(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordBackupDto) {
    const run = await this.backup.record(dto);
    await this.activityLog.log({
      action: `backup.${dto.status.toLowerCase()}`,
      category: 'BACKUP',
      actorId: user.userId,
      companyId: null,
      targetType: 'backup',
      targetId: run.id,
      metadata: { type: dto.type },
    });
    return run;
  }

  @Post('maintenance/run')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Run a maintenance job now (all | sweep | retention | reports | emergencies | backup-check).',
  })
  async run(@CurrentUser() user: AuthenticatedUser, @Body() dto: RunMaintenanceDto) {
    const job = dto.job ?? 'all';
    const result = await this.maintenance.run(job);
    await this.activityLog.log({
      action: 'retention.cleanup_run',
      category: 'RETENTION',
      actorId: user.userId,
      companyId: null,
      metadata: { job },
    });
    return { job, result };
  }
}
