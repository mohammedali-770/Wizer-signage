import { Global, Module } from '@nestjs/common';

import { ClientErrorController } from './client-error.controller';
import { ClientErrorService } from './client-error.service';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';
import { MetricsTokenGuard } from './metrics-token.guard';

@Global()
@Module({
  controllers: [MetricsController, ClientErrorController],
  providers: [MetricsService, MetricsMiddleware, MetricsTokenGuard, ClientErrorService],
  exports: [MetricsService, MetricsMiddleware],
})
export class ObservabilityModule {}
