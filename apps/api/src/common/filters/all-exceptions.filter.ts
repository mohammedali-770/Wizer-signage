import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { ApiError } from '@wizer/types';

import type { AuthenticatedUser } from '../types/auth.types';

/**
 * Global exception filter that converts any thrown error into the platform's
 * standard error envelope: `{ success: false, error: ApiError }`.
 *
 * - HttpExceptions keep their status/message and a derived machine code.
 * - Known Prisma errors map to sensible HTTP statuses (unique -> 409, not
 *   found -> 404) without leaking query internals.
 * - Anything else becomes a 500 and the cause is logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      requestId?: string;
      user?: AuthenticatedUser;
    }>();

    const { status, error } = this.resolve(exception);
    const requestId = request?.requestId;

    if (status >= 500) {
      // Enough context to find the failing request without a second round-trip
      // to the user: WHICH request (id + method + path), WHOSE (company/user),
      // and — critically — the underlying error, which the client never sees.
      // The query string is stripped: it can carry filter values and tokens.
      const path = (request?.originalUrl ?? request?.url ?? '').split('?')[0];
      const who = request?.user
        ? ` company=${request.user.companyId ?? '-'} user=${request.user.userId ?? '-'}`
        : '';
      const cause = exception instanceof Error ? `${exception.name}: ${exception.message}` : '-';
      this.logger.error(
        `${status} ${error.code} [${requestId ?? '-'}] ${request?.method ?? '-'} ${path}${who} — ${cause}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Echo the correlation ID so a user-reported failure maps to one log line.
    // Safe to expose: it is a random UUID with no bearing on authorization.
    if (requestId) error.details = { ...error.details, requestId };

    response.status(status).json({ success: false, error });
  }

  private resolve(exception: unknown): { status: number; error: ApiError } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message: string;
      let details: Record<string, unknown> | undefined;

      let codeOverride: string | undefined;
      if (typeof body === 'string') {
        message = body;
      } else {
        const obj = body as Record<string, unknown>;
        const rawMessage = obj.message;
        message = Array.isArray(rawMessage)
          ? (rawMessage as string[]).join('; ')
          : String(rawMessage ?? exception.message);
        if (Array.isArray(rawMessage)) {
          details = { validation: rawMessage };
        }
        // Honor an explicit machine code on the thrown body (e.g. ACCOUNT_LOCKED).
        if (typeof obj.code === 'string') {
          codeOverride = obj.code;
        }
      }

      return {
        status,
        error: { code: codeOverride ?? this.codeFromStatus(status), message, details },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            error: { code: 'CONFLICT', message: 'A record with these values already exists.' },
          };
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
          };
        case 'P2003':
          return {
            status: HttpStatus.BAD_REQUEST,
            error: { code: 'BAD_REQUEST', message: 'Related record constraint failed.' },
          };
        default:
          break;
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    };
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      423: 'LOCKED',
      429: 'TOO_MANY_REQUESTS',
    };
    return map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  }
}
