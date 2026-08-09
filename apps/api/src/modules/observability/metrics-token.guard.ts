import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetricsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.METRICS_TOKEN?.trim() ?? '';
    if (expected.length < 32) {
      throw new ServiceUnavailableException('Metrics endpoint is not configured.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-wizer-metrics-token') ?? '';
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid metrics token.');
    }
    return true;
  }
}
