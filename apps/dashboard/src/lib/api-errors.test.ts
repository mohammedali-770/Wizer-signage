import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, readBody, toApiError } from './api-errors.ts';

/**
 * Every distinct upload failure used to reach the user as the same generic
 * toast.
 *
 * `apiFetch` and `apiUpload` both did a bare `JSON.parse(await res.text())`.
 * nginx answers 413/502/504 with an HTML page, and an aborted request leaves a
 * truncated body — so the parse threw a SyntaxError, which is not an ApiError,
 * so every caller fell through to its catch-all message. The status code, the
 * one thing that distinguished "file too big" from "gateway timed out" from
 * "the server errored", never reached the screen.
 *
 * The API also returns a `requestId` and logs the real cause against it
 * (AllExceptionsFilter), and the dashboard discarded it. These tests pin both.
 */

/** A response shaped the way nginx or the API would actually send it. */
function respond(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

/** The exact two lines the client runs: decode the body, then build the error. */
async function decodeError(res: Response): Promise<ApiError> {
  return toApiError(res, await readBody(res));
}

describe('API error surfacing', () => {
  it('turns a non-JSON 413 into an ApiError naming the size problem, not a SyntaxError', async () => {
    const err = await decodeError(
      respond(
        '<html><head><title>413 Request Entity Too Large</title></head></html>',
        413,
        'text/html',
      ),
    );

    assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error)?.name}`);
    assert.equal(err.status, 413);
    assert.match(err.message, /413/);
  });

  it('turns a non-JSON 504 into an ApiError that says the server did not respond', async () => {
    const err = await decodeError(respond('<html>504 Gateway Time-out</html>', 504, 'text/html'));

    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 504);
    assert.match(err.message, /504/);
  });

  it('carries the requestId so an opaque 500 becomes one grep', async () => {
    const err = await decodeError(
      respond(
        JSON.stringify({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred.',
            details: { requestId: '6810a0d07e008517f0f4a54a6aaa3442' },
          },
        }),
        500,
        'application/json',
      ),
    );

    assert.ok(err instanceof ApiError);
    assert.equal(err.requestId, '6810a0d07e008517f0f4a54a6aaa3442');
    // The 66 existing call sites render err.message directly, so the reference
    // has to be in there to be seen at all.
    assert.match(err.message, /6810a0d07e008517f0f4a54a6aaa3442/);
  });

  it('still prefers the API envelope message when there is one', async () => {
    const err = await decodeError(
      respond(
        JSON.stringify({ error: { code: 'FILE_TOO_LARGE', message: 'File too large' } }),
        413,
        'application/json',
      ),
    );

    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'FILE_TOO_LARGE');
    assert.equal(err.message, 'File too large');
  });

  it('returns the parsed body unchanged on success', async () => {
    const parsed = await readBody(
      respond(JSON.stringify({ id: 'c1', title: 'ok' }), 200, 'application/json'),
    );

    assert.deepEqual(parsed, { id: 'c1', title: 'ok' });
  });

  it('tolerates an empty body without throwing', async () => {
    // 204 cannot be constructed here (null-body status), and an endpoint that
    // returns an empty 200 is the case that actually reaches this code.
    const parsed = await readBody(respond('', 200, 'application/json'));

    assert.equal(parsed, null);
  });
});
