import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ScreenshotType } from '@prisma/client';

import { resolvePagination } from '../../common/dto/pagination.dto';
import type { PaginationQueryDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedDevice } from '../../common/types/device.types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ScreenshotUploadDto } from './dto/monitoring.dto';

type MulterFile = { buffer: Buffer; mimetype: string; size: number; originalname: string };

/**
 * Screenshot upload (device) + read (dashboard). Images are validated by magic
 * bytes, stored via the storage abstraction under a screen-scoped key, and read
 * back via short-lived signed URLs — never public storage URLs.
 */
@Injectable()
export class ScreenshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    device: AuthenticatedDevice,
    file: MulterFile | undefined,
    dto: ScreenshotUploadDto,
  ) {
    if (!file) throw new BadRequestException('A screenshot image is required.');
    const mime = this.detectImage(file.buffer);
    if (!mime) throw new BadRequestException('Unsupported image (expected JPEG/PNG/WEBP).');

    // Only link a commandId that genuinely belongs to this device's own screen —
    // never store a cross-screen/cross-company command reference.
    let commandId: string | null = null;
    if (dto.commandId) {
      const command = await this.prisma.deviceCommand.findFirst({
        where: { id: dto.commandId, screenId: device.screenId, companyId: device.companyId },
        select: { id: true },
      });
      commandId = command?.id ?? null;
    }

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const takenAt = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    const key = `companies/${device.companyId}/screens/${device.screenId}/screenshots/${takenAt.getTime()}.${ext}`;
    await this.storage.upload(key, file.buffer, mime);

    const shot = await this.prisma.screenshot.create({
      data: {
        companyId: device.companyId,
        screenId: device.screenId,
        deviceId: device.deviceId,
        commandId,
        storageKey: key,
        fileSizeBytes: BigInt(file.size),
        mimeType: mime,
        type: dto.type === 'AUTO' ? ScreenshotType.AUTO : ScreenshotType.MANUAL,
        takenAt,
      },
    });
    return { ok: true, screenshotId: shot.id };
  }

  async list(companyId: string, screenId: string, query: PaginationQueryDto) {
    await this.assertScreen(companyId, screenId);
    const { skip, take, meta } = resolvePagination(query);
    const where: Prisma.ScreenshotWhereInput = { companyId, screenId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.screenshot.findMany({ where, orderBy: { takenAt: 'desc' }, skip, take }),
      this.prisma.screenshot.count({ where }),
    ]);
    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        takenAt: r.takenAt,
        type: r.type,
        mimeType: r.mimeType,
        fileSizeBytes: r.fileSizeBytes != null ? r.fileSizeBytes.toString() : null,
        url: await this.storage
          .getSignedUrl(r.storageKey, r.mimeType ?? 'image/jpeg')
          .catch(() => null),
      })),
    );
    return { items, meta: meta(total) };
  }

  async latest(companyId: string, screenId: string) {
    const r = await this.prisma.screenshot.findFirst({
      where: { companyId, screenId },
      orderBy: { takenAt: 'desc' },
    });
    if (!r) return null;
    return {
      id: r.id,
      takenAt: r.takenAt,
      type: r.type,
      url: await this.storage
        .getSignedUrl(r.storageKey, r.mimeType ?? 'image/jpeg')
        .catch(() => null),
    };
  }

  private async assertScreen(companyId: string, screenId: string) {
    const screen = await this.prisma.screen.findFirst({
      where: { id: screenId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!screen) throw new NotFoundException('Screen not found.');
    return screen;
  }

  /** Magic-byte image detection (JPEG/PNG/WEBP). */
  private detectImage(b: Buffer): string | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
      return 'image/png';
    if (
      b.length >= 12 &&
      b.toString('latin1', 0, 4) === 'RIFF' &&
      b.toString('latin1', 8, 12) === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  }
}
