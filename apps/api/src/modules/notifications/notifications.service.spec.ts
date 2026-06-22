import { EmailService } from './email.service';
import { NotificationService } from './notification.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('EmailService (delivery log)', () => {
  function build() {
    const store = new Map<string, any>();
    let seq = 0;
    const prisma: any = {
      emailDeliveryLog: {
        create: jest.fn(({ data }: any) => {
          const row = { id: `e${++seq}`, ...data };
          store.set(row.id, row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where, data }: any) => {
          const row = store.get(where.id);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
    };
    const mail = { send: jest.fn() };
    const service = new EmailService(prisma, mail as any);
    return { service, prisma, mail, store };
  }

  it('logs PENDING then SENT on success with the provider message id', async () => {
    const t = build();
    t.mail.send.mockResolvedValue({ messageId: 'msg-1', live: true });
    const res = await t.service.sendEvent({
      companyId: 'comp1',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      type: 'screen.offline',
    });
    expect(res.ok).toBe(true);
    const row = t.store.get(res.logId);
    expect(row.status).toBe('SENT');
    expect(row.providerMessageId).toBe('msg-1');
  });

  it('logs FAILED and never throws when the transport errors', async () => {
    const t = build();
    t.mail.send.mockRejectedValue(new Error('smtp down'));
    const res = await t.service.sendEvent({
      companyId: 'comp1',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
    });
    expect(res.ok).toBe(false);
    expect(t.store.get(res.logId).status).toBe('FAILED');
    expect(t.store.get(res.logId).error).toContain('smtp down');
  });
});

describe('NotificationService', () => {
  function build() {
    const prisma: any = {
      notification: {
        create: jest.fn(({ data }: any) =>
          Promise.resolve({ id: 'n1', ...data, createdAt: new Date(), readAt: null }),
        ),
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'n1',
              type: 'x',
              severity: 'INFO',
              title: 'T',
              body: null,
              data: {},
              readAt: null,
              createdAt: new Date(),
            },
          ]),
        count: jest.fn().mockResolvedValue(3),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: (ops: Promise<any>[]) => Promise.all(ops),
    };
    return { service: new NotificationService(prisma), prisma };
  }

  it('lists the caller notifications and includes the unread count', async () => {
    const t = build();
    const out = await t.service.list('u1', { page: 1, pageSize: 20 } as any);
    expect(t.prisma.notification.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1' });
    expect(out.unreadCount).toBe(3);
  });

  it('markRead only affects the caller own unread notification', async () => {
    const t = build();
    await t.service.markRead('u1', 'n1');
    expect(t.prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n1', userId: 'u1', readAt: null } }),
    );
  });

  it('markAllRead scopes to the caller', async () => {
    const t = build();
    const res = await t.service.markAllRead('u1');
    expect(res.updated).toBe(1);
    expect(t.prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', readAt: null } }),
    );
  });
});
