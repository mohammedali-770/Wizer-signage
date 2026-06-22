import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * HealthModule exposes liveness/readiness endpoints used by Docker
 * HEALTHCHECK, the reverse proxy, and orchestration platforms.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
