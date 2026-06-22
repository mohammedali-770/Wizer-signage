import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ScreenshotService } from './screenshot.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const device: any = { id: 'd1', deviceId: 'dev1', screenId: 's1', companyId: 'comp1' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function build() {
  const prisma: any = {
    screen: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
    screenshot: {
      create: jest.fn().mockResolvedValue({ id: 'shot1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    deviceCommand: { findFirst: jest.fn().mockResolvedValue({ id: 'cmd1' }) },
  };
  prisma.$transaction = jest.fn((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
  };
  const service = new ScreenshotService(prisma as any, storage as any);
  return { service, prisma, storage };
}

describe('ScreenshotService.upload', () => {
  it('validates the image, stores it under a screen-scoped key, and records metadata', async () => {
    const t = build();
    const file: any = { buffer: JPEG, mimetype: 'image/jpeg', size: 2048, originalname: 's.jpg' };
    const res = await t.service.upload(device, file, { commandId: 'cmd1' });
    expect(t.storage.upload).toHaveBeenCalledWith(
      expect.stringContaining('companies/comp1/screens/s1/screenshots/'),
      JPEG,
      'image/jpeg',
    );
    expect(t.prisma.screenshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'comp1',
          screenId: 's1',
          commandId: 'cmd1',
          mimeType: 'image/jpeg',
        }),
      }),
    );
    expect(res).toEqual(expect.objectContaining({ ok: true, screenshotId: 'shot1' }));
  });

  it('drops a commandId that does not belong to the device’s own screen', async () => {
    const t = build();
    t.prisma.deviceCommand.findFirst.mockResolvedValue(null); // foreign / unknown command
    const file: any = { buffer: JPEG, mimetype: 'image/jpeg', size: 100, originalname: 's.jpg' };
    await t.service.upload(device, file, { commandId: 'foreign' });
    expect(t.prisma.screenshot.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ commandId: null }) }),
    );
  });

  it('rejects a non-image upload', async () => {
    const t = build();
    const file: any = {
      buffer: Buffer.from('not-an-image'),
      mimetype: 'image/jpeg',
      size: 12,
      originalname: 'x',
    };
    await expect(t.service.upload(device, file, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(t.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects listing screenshots for a screen in another company', async () => {
    const t = build();
    t.prisma.screen.findFirst.mockResolvedValue(null);
    await expect(t.service.list('comp1', 'other', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
