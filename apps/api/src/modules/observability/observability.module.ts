import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { MetricsService } from './metrics.service';
import { MetricsTokenGuard } from './metrics-token.guard';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, MetricsTokenGuard],
  exports: [MetricsService, MetricsMiddleware],
})
export class ObservabilityModule {}
