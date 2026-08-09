import { Logger } from '@nestjs/common';

import { ClientErrorService } from './client-error.service';

describe('ClientErrorService', () => {
  it('logs only the bounded accepted telemetry shape', () => {
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new ClientErrorService();

    expect(
      service.record(
        { userId: 'user-1', companyId: 'company-1' } as never,
        {
          kind: 'WINDOW_ERROR',
          fingerprint: '0123456789abcdef01234567',
          message: 'render failed',
          source: '/_next/static/chunk.js',
          line: 42,
          column: 7,
        },
      ),
    ).toEqual({ accepted: true });

    expect(spy).toHaveBeenCalledWith({
      event: 'dashboard_client_error',
      companyId: 'company-1',
      userId: 'user-1',
      kind: 'WINDOW_ERROR',
      fingerprint: '0123456789abcdef01234567',
      message: 'render failed',
      source: '/_next/static/chunk.js',
      line: 42,
      column: 7,
    });
    spy.mockRestore();
  });
});
