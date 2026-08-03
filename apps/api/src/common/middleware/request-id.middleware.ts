import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Header carrying the correlation ID, in and out. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A request ID is only useful if it is bounded and printable: it is echoed in a
 * response header and written to logs, so an arbitrary client-supplied value
 * would be a log-injection and header-splitting vector.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Express request decorated with the correlation ID. */
export type RequestWithId = Request & { requestId?: string };

/**
 * Assigns every request a correlation ID.
 *
 * Today a 500 logs a stack trace on the server and returns "An unexpected error
 * occurred." to the client, with nothing linking the two — so a user report is
 * unactionable unless the timestamp happens to narrow it down. The ID is
 * returned in the error envelope AND the `X-Request-Id` response header, so a
 * screenshot of the failure is enough to find the exact log line.
 *
 * An inbound `X-Request-Id` is honoured (nginx or a future client can originate
 * the trace) but only when it matches {@link SAFE_REQUEST_ID}; anything else is
 * replaced rather than rejected, because a malformed correlation header must
 * never be the reason a request fails.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
