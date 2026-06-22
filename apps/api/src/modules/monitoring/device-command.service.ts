import { Injectable, NotFoundException } from '@nestjs/common';
import { DeviceCommandStatus, DeviceCommandType, DeviceStatus, Prisma } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import type { CommandResultDto, ListCommandsQueryDto } from './dto/monitoring.dto';
import { COMMAND_TTL_SECONDS } from './monitoring.constants';

type CommandRow = Prisma.DeviceCommandGetPayload<true>;

/**
 * Remote-command lifecycle (Phase 8). Dashboard admins issue commands to their
 * own company's screens; the paired device polls, acks, and reports results —
 * only for its own screen (token-scoped). Pending commands expire after a TTL.
 */
@Injectable()
export class DeviceCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // --- Dashboard side ----------------------------------------------------

  async issue(
    companyId: string,
    actor: AuthenticatedUser,
    screenId: string,
    commandType: DeviceCommandType,
    payload?: Record<string, unknown>,
  ) {
    await this.assertScreen(companyId, screenId);
    const device = await this.prisma.device.findUnique({
      where: { screenId },
      select: { id: true, status: true },
    });
    const command = await this.prisma.deviceCommand.create({
      data: {
        companyId,
        screenId,
        deviceId: device?.status === DeviceStatus.ACTIVE ? device.id : null,
        commandType,
        status: DeviceCommandStatus.PENDING,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        issuedById: actor.userId,
        expiresAt: new Date(Date.now() + COMMAND_TTL_SECONDS * 1000),
      },
    });
    await this.activityLog.log({
      action: `device.command_${commandType.toLowerCase()}`,
      category: 'DEVICE',
      actorId: actor.userId,
      companyId,
      targetType: 'screen',
      targetId: screenId,
      metadata: { commandId: command.id },
    });
    return this.toView(command);
  }

  /**
   * Fan a single command type out to many screens in one shot (Phase 9 — used
   * when an emergency broadcast is activated/paused/ended so affected screens
   * re-resolve their manifest promptly). No per-command activity log; the caller
   * logs the higher-level event. Returns the number of commands created.
   */
  async dispatchToScreens(
    companyId: string,
    screenIds: string[],
    commandType: DeviceCommandType,
    payload?: Record<string, unknown>,
  ): Promise<number> {
    if (screenIds.length === 0) return 0;
    const devices = await this.prisma.device.findMany({
      where: { screenId: { in: screenIds }, companyId, status: DeviceStatus.ACTIVE },
      select: { id: true, screenId: true },
    });
    const deviceByScreen = new Map(devices.map((d) => [d.screenId, d.id]));
    const expiresAt = new Date(Date.now() + COMMAND_TTL_SECONDS * 1000);
    const result = await this.prisma.deviceCommand.createMany({
      data: screenIds.map((screenId) => ({
        companyId,
        screenId,
        deviceId: deviceByScreen.get(screenId) ?? null,
        commandType,
        status: DeviceCommandStatus.PENDING,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        expiresAt,
      })),
    });
    return result.count;
  }

  async list(companyId: string, screenId: string, query: ListCommandsQueryDto) {
    await this.assertScreen(companyId, screenId);
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.DeviceCommandWhereInput = { companyId, screenId };
    if (query.status) where.status = query.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.deviceCommand.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.deviceCommand.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), meta: meta(total) };
  }

  async get(companyId: string, screenId: string, commandId: string) {
    const command = await this.prisma.deviceCommand.findFirst({
      where: { id: commandId, companyId, screenId },
    });
    if (!command) throw new NotFoundException('Command not found.');
    return this.toView(command);
  }

  // --- Device side -------------------------------------------------------

  /** Pending commands for the device's own screen; marks them DELIVERED. */
  async pending(device: AuthenticatedDevice) {
    // Expire any stale pending commands first.
    await this.prisma.deviceCommand.updateMany({
      where: {
        screenId: device.screenId,
        status: DeviceCommandStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: DeviceCommandStatus.EXPIRED },
    });
    const commands = await this.prisma.deviceCommand.findMany({
      where: {
        screenId: device.screenId,
        companyId: device.companyId,
        status: DeviceCommandStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    if (commands.length) {
      await this.prisma.deviceCommand.updateMany({
        where: { id: { in: commands.map((c) => c.id) } },
        data: { status: DeviceCommandStatus.DELIVERED, deliveredAt: new Date() },
      });
    }
    return {
      commands: commands.map((c) => ({ id: c.id, commandType: c.commandType, payload: c.payload })),
    };
  }

  async ack(device: AuthenticatedDevice, commandId: string) {
    const command = await this.ownCommand(device, commandId);
    if (
      command.status === DeviceCommandStatus.PENDING ||
      command.status === DeviceCommandStatus.DELIVERED
    ) {
      await this.prisma.deviceCommand.update({
        where: { id: commandId },
        data: {
          status: DeviceCommandStatus.RUNNING,
          startedAt: new Date(),
          deliveredAt: command.deliveredAt ?? new Date(),
        },
      });
    }
    return { ok: true };
  }

  async result(device: AuthenticatedDevice, commandId: string, dto: CommandResultDto) {
    await this.ownCommand(device, commandId);
    await this.prisma.deviceCommand.update({
      where: { id: commandId },
      data: {
        status: dto.status,
        result: (dto.result ?? {}) as Prisma.InputJsonValue,
        error: dto.error ?? null,
        completedAt: new Date(),
      },
    });
    return { ok: true };
  }

  // --- Helpers -----------------------------------------------------------

  private async ownCommand(device: AuthenticatedDevice, commandId: string): Promise<CommandRow> {
    const command = await this.prisma.deviceCommand.findFirst({
      where: { id: commandId, screenId: device.screenId, companyId: device.companyId },
    });
    if (!command) throw new NotFoundException('Command not found.');
    return command;
  }

  private async assertScreen(companyId: string, screenId: string) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: screenId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    return screen;
  }

  private toView(c: CommandRow) {
    return {
      id: c.id,
      screenId: c.screenId,
      commandType: c.commandType,
      status: c.status,
      payload: c.payload,
      result: c.result,
      error: c.error,
      issuedById: c.issuedById,
      deliveredAt: c.deliveredAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
