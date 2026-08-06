import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService, type HealthStatus, type ReadinessStatus } from './health.service';
import { HealthStatusDto, ReadinessStatusDto } from './dto/health-response.dto';

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
  // `@ApiResponse({ status: 200, description })` documents THAT a 200 happens
  // and nothing about its body — a generated client got `unknown`. A
  // description is not a schema.
  @ApiOkResponse({ type: HealthStatusDto, description: 'Service is alive.' })
  check(): HealthStatus {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Verifies database connectivity and reports storage/mail configuration. Returns 503 when not ready.',
  })
  @ApiOkResponse({ type: ReadinessStatusDto, description: 'Service is ready.' })
  @ApiResponse({
    status: 503,
    type: ReadinessStatusDto,
    description: 'Not ready. Same body, with status `degraded` and the failing check.',
  })
  async ready(): Promise<ReadinessStatus> {
    const status = await this.healthService.ready();
    // Surface a 503 so load balancers / orchestrators stop routing traffic.
    if (status.status !== 'ok') throw new ServiceUnavailableException(status);
    return status;
  }
}
