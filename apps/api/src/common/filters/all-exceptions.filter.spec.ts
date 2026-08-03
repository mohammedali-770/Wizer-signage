import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AllExceptionsFilter } from './all-exceptions.filter';

/* eslint-disable @typescript-eslint/no-explicit-any */

function host(request: Record<string, unknown> = {}) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  return {
    json,
    status,
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as any,
  };
}

describe('AllExceptionsFilter', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errorLog.mockRestore());

  it('returns the platform envelope for an HttpException', () => {
    const t = host();
    new AllExceptionsFilter().catch(new BadRequestException('bad input'), t.host);
    expect(t.status).toHaveBeenCalledWith(400);
    expect(t.json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({ code: 'BAD_REQUEST', message: 'bad input' }),
    });
  });

  it('echoes the request ID to the client so a report maps to a log line', () => {
    const t = host({ requestId: 'req-123' });
    new AllExceptionsFilter().catch(new Error('boom'), t.host);
    const body = t.json.mock.calls[0][0];
    expect(body.error.details).toMatchObject({ requestId: 'req-123' });
  });

  it('keeps existing details when adding the request ID', () => {
    const t = host({ requestId: 'req-123' });
    new AllExceptionsFilter().catch(
      new HttpException({ message: ['name must be a string'] }, 400),
      t.host,
    );
    const body = t.json.mock.calls[0][0];
    expect(body.error.details).toMatchObject({
      validation: ['name must be a string'],
      requestId: 'req-123',
    });
  });

  it('omits the details key entirely when there is no request ID', () => {
    const t = host();
    new AllExceptionsFilter().catch(new BadRequestException('bad'), t.host);
    expect(t.json.mock.calls[0][0].error.details).toBeUndefined();
  });

  it('logs the request ID, route, actor, and underlying cause on a 500', () => {
    const t = host({
      requestId: 'req-abc',
      method: 'POST',
      originalUrl: '/api/content/upload?token=SECRET',
      user: { userId: 'u1', companyId: 'c1' },
    });
    new AllExceptionsFilter().catch(new TypeError('undefined is not a function'), t.host);

    const line = errorLog.mock.calls[0][0] as string;
    expect(line).toContain('[req-abc]');
    expect(line).toContain('POST /api/content/upload');
    expect(line).toContain('company=c1 user=u1');
    expect(line).toContain('TypeError: undefined is not a function');
    // The query string can carry filter values and tokens — never logged.
    expect(line).not.toContain('SECRET');
  });

  it('never leaks the underlying cause to the client on a 500', () => {
    const t = host({ requestId: 'r' });
    new AllExceptionsFilter().catch(new Error('connect ECONNREFUSED 10.0.0.5:5432'), t.host);
    const body = t.json.mock.calls[0][0];
    expect(t.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('does not log 4xx responses as server errors', () => {
    const t = host({ requestId: 'r' });
    new AllExceptionsFilter().catch(new BadRequestException('nope'), t.host);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('maps a Prisma unique violation to 409 without leaking query internals', () => {
    const t = host();
    new AllExceptionsFilter().catch(
      new Prisma.PrismaClientKnownRequestError('unique failed on users.email', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
      t.host,
    );
    expect(t.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(t.json.mock.calls[0][0])).not.toContain('users.email');
  });

  it('survives a context with no request object', () => {
    const t = host(undefined as any);
    expect(() => new AllExceptionsFilter().catch(new Error('x'), t.host)).not.toThrow();
    expect(t.status).toHaveBeenCalledWith(500);
  });
});
