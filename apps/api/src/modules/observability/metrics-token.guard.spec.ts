import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { MetricsTokenGuard } from './metrics-token.guard';

function context(header: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'x-wizer-metrics-token' ? header : undefined,
      }),
    }),
  } as never;
}

describe('MetricsTokenGuard', () => {
  const original = process.env.METRICS_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = original;
  });

  it('fails closed when no strong token is configured', () => {
    delete process.env.METRICS_TOKEN;
    expect(() => new MetricsTokenGuard().canActivate(context(undefined))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects an invalid token', () => {
    process.env.METRICS_TOKEN = 'a'.repeat(40);
    expect(() => new MetricsTokenGuard().canActivate(context('b'.repeat(40)))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts only the exact configured token', () => {
    process.env.METRICS_TOKEN = 'correct-metrics-token-with-more-than-32-chars';
    expect(
      new MetricsTokenGuard().canActivate(
        context('correct-metrics-token-with-more-than-32-chars'),
      ),
    ).toBe(true);
  });
});
