import { RequestIdMiddleware, type RequestWithId } from './request-id.middleware';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(headers: Record<string, unknown> = {}) {
  const middleware = new RequestIdMiddleware();
  const req = { headers } as unknown as RequestWithId;
  const res = { setHeader: jest.fn() } as any;
  const next = jest.fn();
  middleware.use(req, res, next);
  return { req, res, next };
}

describe('RequestIdMiddleware', () => {
  it('assigns a random UUID when the client sends nothing', () => {
    const { req, res, next } = run();
    expect(req.requestId).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('gives every request a distinct ID', () => {
    expect(run().req.requestId).not.toBe(run().req.requestId);
  });

  it('honours a well-formed inbound ID so a trace can span nginx and the API', () => {
    const { req } = run({ 'x-request-id': 'edge-01ABCdef_9.x' });
    expect(req.requestId).toBe('edge-01ABCdef_9.x');
  });

  it('replaces a header-splitting payload rather than echoing it', () => {
    const { req } = run({ 'x-request-id': 'abc\r\nSet-Cookie: evil=1' });
    expect(req.requestId).toMatch(UUID);
  });

  it('replaces an over-long ID', () => {
    const { req } = run({ 'x-request-id': 'a'.repeat(129) });
    expect(req.requestId).toMatch(UUID);
    expect(run({ 'x-request-id': 'a'.repeat(128) }).req.requestId).toBe('a'.repeat(128));
  });

  it('replaces an empty ID', () => {
    expect(run({ 'x-request-id': '' }).req.requestId).toMatch(UUID);
  });

  it('handles a repeated header without crashing', () => {
    const { req } = run({ 'x-request-id': ['first-id', 'second-id'] });
    expect(req.requestId).toBe('first-id');
  });

  it('never fails the request over a malformed correlation header', () => {
    const { next } = run({ 'x-request-id': '<script>' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
