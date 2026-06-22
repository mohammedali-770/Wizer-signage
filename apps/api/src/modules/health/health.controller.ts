import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService, type HealthStatus, type ReadinessStatus } from './health.service';

// Health probes must be reachable without a token (load balancers, Nginx, k8s
// liveness/readiness) and should not consume the rate-limit bucket.
@Public()
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns the running status, version and uptime of the API.',
  })
  @ApiResponse({ status: 200, description: 'Service is alive.' })
  check(): HealthStatus {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Verifies database connectivity and reports storage/mail configuration. Returns 503 when not ready.',
  })
  @ApiResponse({ status: 200, description: 'Service is ready.' })
  @ApiResponse({ status: 503, description: 'Service is not ready (e.g. database unreachable).' })
  async ready(): Promise<ReadinessStatus> {
    const status = await this.healthService.ready();
    // Surface a 503 so load balancers / orchestrators stop routing traffic.
    if (status.status !== 'ok') throw new ServiceUnavailableException(status);
    return status;
  }
}
