import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if ((req.originalUrl ?? req.url).split('?')[0] === '/api/internal/metrics') {
      next();
      return;
    }

    this.metrics.requestStarted();
    const started = process.hrtime.bigint();
    let recorded = false;
    const finish = (): void => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const routePath =
        typeof req.route?.path === 'string' ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
      this.metrics.requestFinished(req.method, routePath, res.statusCode, durationSeconds);
    };

    res.once('finish', finish);
    res.once('close', finish);
    next();
  }
}
