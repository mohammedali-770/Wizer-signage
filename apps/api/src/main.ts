import 'reflect-metadata';

import { ConsoleLogger, Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PerfLoggingInterceptor } from './common/interceptors/perf-logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { API_VERSION } from './common/version';
import type { AppConfig } from './config/configuration';
import { buildOpenApiConfig } from './openapi.config';

function resolveLogLevels(raw: string | undefined): LogLevel[] {
  const order: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error'];
  const requested = (raw ?? 'info').trim().toLowerCase();
  const alias: Record<string, LogLevel> = {
    trace: 'verbose',
    verbose: 'verbose',
    debug: 'debug',
    info: 'log',
    log: 'log',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
    fatal: 'error',
  };
  const min = alias[requested] ?? 'log';
  return order.slice(order.indexOf(min));
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const logLevels = resolveLogLevels(process.env.LOG_LEVEL);
  const structuredLogs = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    logger: structuredLogs
      ? new ConsoleLogger({ json: true, logLevels, compact: true })
      : logLevels,
  });

  app.set('trust proxy', 1);

  const config = app.get(ConfigService);
  const httpConfig = config.get<AppConfig['http']>('http', { infer: true });
  const nodeEnv = config.get<AppConfig['nodeEnv']>('nodeEnv', { infer: true });
  const port = httpConfig?.port ?? Number(process.env.API_PORT) ?? 3001;
  const host = httpConfig?.host ?? process.env.API_HOST ?? '0.0.0.0';
  const corsOrigins = httpConfig?.corsOrigins ?? [];
  const allowAllOrigins = corsOrigins.includes('*');

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: allowAllOrigins ? true : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new PerfLoggingInterceptor(), new TimeoutInterceptor());
  app.enableShutdownHooks();

  const swaggerEnabled = nodeEnv !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = buildOpenApiConfig(API_VERSION);
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port, host);

  const baseUrl = `http://${host}:${port}`;
  logger.log(`Wizer Signage API (${nodeEnv ?? 'development'}) listening on ${baseUrl}`);
  logger.log(`Health:  ${baseUrl}/api/health`);
  if (swaggerEnabled) logger.log(`Swagger: ${baseUrl}/api/docs`);
}

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  new Logger('Process').error(`Unhandled promise rejection: ${message}`);
});

process.on('uncaughtException', (error: Error) => {
  new Logger('Process').error(`Uncaught exception: ${error.stack ?? error.message}`);
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  new Logger('Bootstrap').error(`Failed to start Wizer Signage API: ${message}`);
  process.exit(1);
});
