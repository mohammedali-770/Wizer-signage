import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PerfLoggingInterceptor } from './common/interceptors/perf-logging.interceptor';
import type { AppConfig } from './config/configuration';

/**
 * Application entrypoint.
 *
 * Bootstraps the Nest application with the conventions shared across the
 * MasterSignage monorepo:
 *  - global route prefix `api`
 *  - Helmet security headers
 *  - a strict global ValidationPipe (whitelist + transform)
 *  - CORS sourced from CORS_ORIGINS
 *  - Swagger UI at `/api/docs`
 *  - listens on API_PORT (default 3001)
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  // Behind Nginx/Let's Encrypt: trust the first proxy hop so `req.ip` and
  // X-Forwarded-* reflect the real client (used for login/audit logging).
  app.set('trust proxy', 1);

  const config = app.get(ConfigService);
  const httpConfig = config.get<AppConfig['http']>('http', { infer: true });
  const nodeEnv = config.get<AppConfig['nodeEnv']>('nodeEnv', { infer: true });

  const port = httpConfig?.port ?? Number(process.env.API_PORT) ?? 3001;
  // Bind 0.0.0.0 by default so the API is reachable across the Docker network
  // (the nginx reverse proxy connects to api:3001). Binding to localhost inside
  // a container makes nginx unable to proxy and returns 502. Override with
  // API_HOST (e.g. 127.0.0.1) for a hardened single-host local setup.
  const host = httpConfig?.host ?? process.env.API_HOST ?? '0.0.0.0';
  const corsOrigins = httpConfig?.corsOrigins ?? ['*'];
  const allowAllOrigins = corsOrigins.includes('*');

  // --- Global route prefix -------------------------------------------------
  app.setGlobalPrefix('api');

  // --- Security headers ----------------------------------------------------
  app.use(helmet());

  // --- CORS ----------------------------------------------------------------
  app.enableCors({
    origin: allowAllOrigins ? true : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // --- Validation ----------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // --- Performance request logging ----------------------------------------
  // Safe per-request timing (method/path/status/duration + user/company ids).
  // Slow requests warn by default; full logging via PERF_LOG_REQUESTS=true.
  app.useGlobalInterceptors(new PerfLoggingInterceptor());

  // --- Graceful shutdown ---------------------------------------------------
  app.enableShutdownHooks();

  // --- Swagger / OpenAPI ---------------------------------------------------
  // SECURITY: the docs route is unauthenticated and reveals the full API
  // surface, so it is DISABLED in production. Set SWAGGER_ENABLED=true to force
  // it on (e.g. a locked-down staging host).
  const swaggerEnabled = nodeEnv !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Wizer Signage API')
      .setDescription('Wizer Signage — multi-tenant digital signage SaaS platform REST API.')
      .setVersion(process.env.npm_package_version ?? '0.0.0')
      .addBearerAuth()
      .build();
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

void bootstrap();
