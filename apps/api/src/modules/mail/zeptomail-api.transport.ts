/**
 * ZeptoMail HTTPS transport.
 *
 * DigitalOcean blocks outbound TCP 25/465/587 on every Droplet by default, and
 * ZeptoMail offers no alternate submission port (only 465 and 587). On a blocked
 * host every SMTP send dies in `connect` with an opaque `ETIMEDOUT` after the
 * socket timeout, which looks identical to a wrong password or a bad hostname.
 * This transport carries the same messages over ZeptoMail's REST endpoint on
 * 443, which no provider policy blocks, and surfaces the provider's own error
 * code instead of a timeout.
 */

/** Sender/recipient split out of an RFC 5322 address. */
export interface ParsedAddress {
  address: string;
  name?: string;
}

export interface ZeptoMailApiOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ZeptoMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const ZEPTOMAIL_DEFAULT_ENDPOINT = 'https://api.zeptomail.com/v1.1/email';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Split `Wizer Signage <no-reply@wizer.sa>` into its parts. ZeptoMail's API
 * takes address and display name as separate JSON fields, so the single
 * SMTP_FROM string every other transport accepts has to be taken apart here.
 * A bare `no-reply@wizer.sa` yields no name, which the API allows.
 */
export function parseAddress(value: string): ParsedAddress {
  const trimmed = value.trim();
  const angled = /^(.*)<([^<>]+)>$/.exec(trimmed);
  if (!angled) {
    return { address: trimmed };
  }

  const [, rawName, rawAddress] = angled;
  if (!rawAddress) {
    return { address: trimmed };
  }

  // Display names may be quoted ("Wizer, Signage" <…>) precisely because they
  // can contain characters that would otherwise need escaping; strip one
  // matching pair rather than every quote, so a name that legitimately
  // contains a quote survives.
  const name = (rawName ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
  const address = rawAddress.trim();
  return name ? { address, name } : { address };
}

/** Shape of the error payload documented for the v1.1 endpoint. */
interface ZeptoMailErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ code?: string; message?: string; target?: string }>;
  };
}

interface ZeptoMailSuccessBody {
  request_id?: string;
  data?: Array<{ code?: string; message?: string; additional_info?: unknown }>;
}

export class ZeptoMailApiTransport {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ZeptoMailApiOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint?.trim() || ZEPTOMAIL_DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async send(message: ZeptoMailMessage): Promise<{ messageId: string | null }> {
    const from = parseAddress(message.from);
    const to = parseAddress(message.to);

    const body: Record<string, unknown> = {
      from: from.name ? { address: from.address, name: from.name } : { address: from.address },
      to: [
        {
          email_address: to.name ? { address: to.address, name: to.name } : { address: to.address },
        },
      ],
      subject: message.subject,
      textbody: message.text,
    };
    if (message.html) {
      body.htmlbody = message.html;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          // ZeptoMail's scheme is the literal word "Zoho-enczapikey" followed
          // by the Send Mail token — not "Bearer".
          Authorization: `Zoho-enczapikey ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // SECURITY: report the failure without the request — the JSON body holds
      // the rendered email, and password-reset and invitation mails carry
      // single-use bearer tokens in their links.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`ZeptoMail API request failed: ${reason}`);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `ZeptoMail API rejected the message (HTTP ${response.status}): ${describeError(raw)}`,
      );
    }

    const parsed = safeParse<ZeptoMailSuccessBody>(raw);
    // ZeptoMail returns a per-request id rather than an RFC 5322 Message-ID.
    // It is what their dashboard and support search on, so it is the useful
    // handle to log.
    return { messageId: parsed?.request_id ?? null };
  }
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Turn an error payload into one line. Falls back to the raw text — truncated,
 * because a proxy or WAF in front of the API may answer with an HTML page.
 */
function describeError(raw: string): string {
  const parsed = safeParse<ZeptoMailErrorBody>(raw);
  const error = parsed?.error;
  if (!error) {
    const flat = raw.replace(/\s+/g, ' ').trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat || '(empty response)';
  }

  const head = [error.code, error.message].filter(Boolean).join(' ');
  const details = (error.details ?? [])
    .map((detail) => [detail.target, detail.code, detail.message].filter(Boolean).join(' '))
    .filter((line) => line.length > 0);

  return details.length > 0 ? `${head} (${details.join('; ')})` : head || '(no error detail)';
}
