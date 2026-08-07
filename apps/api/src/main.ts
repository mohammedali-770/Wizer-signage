import 'reflect-metadata';

import { Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';

import { buildOpenApiConfig } from './openapi.config';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PerfLoggingInterceptor } from './common/interceptors/perf-logging.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { API_VERSION } from './common/version';
import type { AppConfig } from './config/configuration';

/**
 * Application entrypoint.
 *
 * Bootstraps the Nest application with the conventions shared across the
 * Wizer Signage monorepo:
 *  - global route prefix `api`
 *  - Helmet security headers
 *  - a strict global ValidationPipe (whitelist + transform)
 *  - CORS sourced from CORS_ORIGINS
 *  - Swagger UI at `/api/docs`
 *  - listens on API_PORT (default 3001)
 */
/**
 * Map LOG_LEVEL to the Nest log levels that should be emitted.
 *
 * Without this, Nest's defaults are always active — including `debug` — so
 * LOG_LEVEL was parsed into config and then ignored, making it impossible to
 * quiet a noisy production box (or to keep debug output out of it).
 */
function resolveLogLevels(raw: string | undefined): LogLevel[] {
  const order: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error'];
  const requested = (raw ?? 'info').trim().toLowerCase();
  // Accept the common syslog-ish spellings as aliases of Nest's own names.
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    logger: resolveLogLevels(process.env.LOG_LEVEL),
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
  // corsOrigins is resolved + validated in configuration.ts (see config/cors.ts):
  // in production it is an explicit, HTTPS-only allowlist and a misconfiguration
  // has already failed boot above. The `*` sentinel only appears in dev/test and
  // maps to Nest's "reflect the request origin" behaviour.
  const corsOrigins = httpConfig?.corsOrigins ?? [];
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
  // Order matters: the timeout must wrap the handler, and perf logging should
  // still observe the (failed) request.
  app.useGlobalInterceptors(new PerfLoggingInterceptor(), new TimeoutInterceptor());

  // --- Graceful shutdown ---------------------------------------------------
  app.enableShutdownHooks();

  // --- Swagger / OpenAPI ---------------------------------------------------
  // SECURITY: the docs route is unauthenticated and reveals the full API
  // surface, so it is DISABLED in production. Set SWAGGER_ENABLED=true to force
  // it on (e.g. a locked-down staging host).
  const swaggerEnabled = nodeEnv !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    // Shared with scripts/emit-openapi.ts so the committed contract in
    // contracts/openapi.json describes the same surface these docs serve.
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

// --- Process-level safety nets ---------------------------------------------
// Without these an unhandled rejection (e.g. an un-awaited storage/mail call)
// terminates the process on Node 20 with no attribution, or — worse — leaves it
// running in an undefined state. Log loudly so the crash is diagnosable from
// `docker logs` and the container's restart policy can do its job.
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  new Logger('Process').error(`Unhandled promise rejection: ${message}`);
});

process.on('uncaughtException', (error: Error) => {
  new Logger('Process').error(`Uncaught exception: ${error.stack ?? error.message}`);
  // An uncaught exception leaves the process in an unknown state — exit and let
  // Docker's `restart: unless-stopped` bring back a clean one.
  process.exit(1);
});

bootstrap().catch((error: unknown) => {
  // A misconfiguration (e.g. missing/invalid CORS_ORIGINS in production) must
  // fail closed: log the reason and exit non-zero BEFORE serving traffic. The
  // error message names the offending variable/reason only — never the full env.
  const message = error instanceof Error ? error.message : String(error);
  new Logger('Bootstrap').error(`Failed to start Wizer Signage API: ${message}`);
  process.exit(1);
});
