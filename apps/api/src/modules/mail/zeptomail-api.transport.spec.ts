import {
  ZEPTOMAIL_DEFAULT_ENDPOINT,
  ZeptoMailApiTransport,
  parseAddress,
} from './zeptomail-api.transport';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Captures the single call a send makes, so the request can be asserted on. */
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return typeof response === 'function' ? response() : response;
  }) as unknown as typeof fetch;

  /** Narrows the optional index access and fails loudly if no send happened. */
  const only = (): { url: string; init: RequestInit } => {
    const [call] = calls;
    if (!call) throw new Error('expected the transport to call fetch, but it did not');
    return call;
  };

  return { impl, calls, only };
}

const message = {
  from: 'Wizer Signage <no-reply@wizer.sa>',
  to: 'operator@example.com',
  subject: 'Reset your password',
  text: 'Follow the link.',
};

describe('parseAddress', () => {
  it('splits a display name from the address', () => {
    expect(parseAddress('Wizer Signage <no-reply@wizer.sa>')).toEqual({
      address: 'no-reply@wizer.sa',
      name: 'Wizer Signage',
    });
  });

  it('accepts a bare address with no display name', () => {
    expect(parseAddress('no-reply@wizer.sa')).toEqual({ address: 'no-reply@wizer.sa' });
  });

  it('accepts angle brackets with no display name', () => {
    expect(parseAddress('<no-reply@wizer.sa>')).toEqual({ address: 'no-reply@wizer.sa' });
  });

  it('strips the quotes a name needs when it contains a comma', () => {
    expect(parseAddress('"Wizer, Signage" <no-reply@wizer.sa>')).toEqual({
      address: 'no-reply@wizer.sa',
      name: 'Wizer, Signage',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAddress('  Wizer  <no-reply@wizer.sa>  ')).toEqual({
      address: 'no-reply@wizer.sa',
      name: 'Wizer',
    });
  });
});

describe('ZeptoMailApiTransport', () => {
  it('posts to the documented endpoint with the Zoho-enczapikey scheme', async () => {
    const { impl, calls, only } = stubFetch(jsonResponse(201, { request_id: 'req-1' }));
    await new ZeptoMailApiTransport({ apiKey: 'token-abc', fetchImpl: impl }).send(message);

    expect(calls).toHaveLength(1);
    expect(only().url).toBe(ZEPTOMAIL_DEFAULT_ENDPOINT);
    expect(only().init.method).toBe('POST');
    const headers = only().init.headers as Record<string, string>;
    // Not "Bearer" — ZeptoMail rejects the message outright with the wrong scheme.
    expect(headers.Authorization).toBe('Zoho-enczapikey token-abc');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends the nested recipient shape the v1.1 API requires', async () => {
    const { impl, only } = stubFetch(jsonResponse(201, { request_id: 'req-2' }));
    await new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send({
      ...message,
      html: '<p>Follow the link.</p>',
    });

    const body = JSON.parse(String(only().init.body));
    expect(body).toMatchObject({
      from: { address: 'no-reply@wizer.sa', name: 'Wizer Signage' },
      to: [{ email_address: { address: 'operator@example.com' } }],
      subject: 'Reset your password',
      textbody: 'Follow the link.',
      htmlbody: '<p>Follow the link.</p>',
    });
  });

  it('omits htmlbody entirely for a text-only message', async () => {
    const { impl, only } = stubFetch(jsonResponse(201, { request_id: 'req-3' }));
    await new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message);

    expect(JSON.parse(String(only().init.body))).not.toHaveProperty('htmlbody');
  });

  it('returns the request id as the message id', async () => {
    const { impl } = stubFetch(jsonResponse(201, { request_id: 'req-4' }));
    const result = await new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message);
    expect(result.messageId).toBe('req-4');
  });

  it('returns a null message id rather than throwing when the id is absent', async () => {
    const { impl } = stubFetch(jsonResponse(201, { message: 'OK' }));
    const result = await new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message);
    expect(result.messageId).toBeNull();
  });

  it('honours a custom endpoint for a non-default ZeptoMail region', async () => {
    const { impl, only } = stubFetch(jsonResponse(201, {}));
    await new ZeptoMailApiTransport({
      apiKey: 'k',
      endpoint: 'https://api.zeptomail.eu/v1.1/email',
      fetchImpl: impl,
    }).send(message);
    expect(only().url).toBe('https://api.zeptomail.eu/v1.1/email');
  });

  it('falls back to the default endpoint when the override is blank', async () => {
    const { impl, only } = stubFetch(jsonResponse(201, {}));
    await new ZeptoMailApiTransport({ apiKey: 'k', endpoint: '   ', fetchImpl: impl }).send(
      message,
    );
    expect(only().url).toBe(ZEPTOMAIL_DEFAULT_ENDPOINT);
  });

  // The header carries the Send Mail token and the body is the rendered email,
  // so a plaintext or hostless endpoint must never be constructible. Preflight
  // checks this too, but it runs on only one of the deploy paths.
  it.each([
    ['plaintext http', 'http://api.zeptomail.com/v1.1/email'],
    ['a hostless https', 'https://'],
    ['a scheme-less host', 'api.zeptomail.com/v1.1/email'],
    ['a lookalike scheme', 'httpx://api.zeptomail.com/v1.1/email'],
    ['plain nonsense', 'not-a-url'],
  ])('refuses to construct with %s', (_label, endpoint) => {
    expect(() => new ZeptoMailApiTransport({ apiKey: 'k', endpoint })).toThrow(
      /ZeptoMail endpoint (must use https|is not a valid URL)/,
    );
  });

  it('surfaces the provider error code and message on a rejection', async () => {
    const { impl } = stubFetch(
      jsonResponse(401, {
        error: { code: 'TM_3201', message: 'Invalid API Token found', request_id: 'r' },
      }),
    );
    await expect(
      new ZeptoMailApiTransport({ apiKey: 'wrong', fetchImpl: impl }).send(message),
    ).rejects.toThrow(/HTTP 401.*TM_3201.*Invalid API Token found/s);
  });

  it('includes per-field detail when the provider names the offending field', async () => {
    const { impl } = stubFetch(
      jsonResponse(400, {
        error: {
          code: 'TM_3301',
          message: 'Invalid Request',
          details: [{ code: 'SM_113', message: 'Invalid domain', target: 'from' }],
        },
      }),
    );
    await expect(
      new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message),
    ).rejects.toThrow(/from SM_113 Invalid domain/);
  });

  it('does not choke when a proxy answers with HTML instead of JSON', async () => {
    const { impl } = stubFetch(
      new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }),
    );
    await expect(
      new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message),
    ).rejects.toThrow(/HTTP 502.*502 Bad Gateway/s);
  });

  it('wraps a network failure instead of leaking an undecorated fetch error', async () => {
    const { impl } = stubFetch(() => Promise.reject(new Error('ETIMEDOUT')));
    await expect(
      new ZeptoMailApiTransport({ apiKey: 'k', fetchImpl: impl }).send(message),
    ).rejects.toThrow(/ZeptoMail API request failed: ETIMEDOUT/);
  });

  // SECURITY: the request body is the rendered email. Password-reset and
  // invitation mails carry single-use bearer tokens in their links, and the
  // header carries the API key — neither may reach a log via an error message.
  it('never puts the API key or the message body into an error', async () => {
    const { impl } = stubFetch(jsonResponse(401, { error: { code: 'TM_3201' } }));
    const secretBody = 'https://signage.wizer.sa/reset?token=SINGLE-USE-SECRET';
    const error = await new ZeptoMailApiTransport({ apiKey: 'API-KEY-SECRET', fetchImpl: impl })
      .send({ ...message, text: secretBody })
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('API-KEY-SECRET');
    expect((error as Error).message).not.toContain('SINGLE-USE-SECRET');
  });

  it('does the same for a network failure', async () => {
    const { impl } = stubFetch(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const error = await new ZeptoMailApiTransport({ apiKey: 'API-KEY-SECRET', fetchImpl: impl })
      .send({ ...message, text: 'token=SINGLE-USE-SECRET' })
      .catch((caught: Error) => caught);

    expect((error as Error).message).not.toContain('API-KEY-SECRET');
    expect((error as Error).message).not.toContain('SINGLE-USE-SECRET');
  });
});
