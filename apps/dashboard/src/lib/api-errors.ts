/**
 * Decoding an API response into a useful error.
 *
 * Deliberately a leaf module with no imports: the whole point is that these
 * are unit-testable without constructing the client, its token storage, or a
 * base URL. The bug this exists to prevent shipped precisely because the only
 * copy of this logic was inlined twice inside an untestable module.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /**
   * The API's correlation id, when it sent one.
   *
   * `AllExceptionsFilter` puts this in `error.details.requestId` and logs the
   * real cause against it, so a user who can quote this id turns an opaque
   * "unexpected error" into one grep. It was being discarded.
   */
  readonly requestId?: string;

  constructor(code: string, message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * Read a response body that may not be JSON at all.
 *
 * A bare `JSON.parse(text)` here is why every upload failure looked identical:
 * nginx answers 413/502/504 with an HTML page and an aborted request leaves a
 * truncated body, so the parse threw a SyntaxError — which is not an ApiError,
 * so callers fell through to their generic catch-all toast. The status code,
 * the only thing that distinguished the failures, never reached the user.
 */
export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON. Deliberately not an error: the caller builds a useful message
    // from the HTTP status instead.
    return null;
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; details?: { requestId?: string } };
};

/**
 * Build an ApiError from a response, using the platform envelope when present
 * and the HTTP status when it is not.
 */
export function toApiError(res: Response, json: unknown): ApiError {
  const envelope = (json as ErrorEnvelope | null)?.error;
  if (envelope?.message) {
    const requestId = envelope.details?.requestId;
    // Appended to the message rather than surfaced separately: 66 call sites
    // already render `err.message` in a toast, and a reference the operator can
    // quote is worth more than a tidier string. The API logs the real cause
    // against this id, so "An unexpected error occurred. (ref: 6810a0d0…)"
    // becomes one grep instead of a dead end.
    const message = requestId ? `${envelope.message} (ref: ${requestId})` : envelope.message;
    return new ApiError(envelope.code ?? `HTTP_${res.status}`, message, res.status, requestId);
  }
  // No envelope — say what the edge actually did, rather than nothing.
  const fallback =
    res.status === 413
      ? `The file is larger than the server accepts (413).`
      : res.status === 502 || res.status === 503 || res.status === 504
        ? `The server did not respond in time (${res.status}). A large upload may have timed out.`
        : `${res.statusText || 'Request failed'} (${res.status}).`;
  return new ApiError(`HTTP_${res.status}`, fallback, res.status);
}
