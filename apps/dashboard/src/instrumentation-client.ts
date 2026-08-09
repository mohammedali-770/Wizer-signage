import { API_BASE_URL } from './lib/api-base';
import { getAccessToken } from './lib/api';
import { buildClientErrorPayload, type ClientErrorPayload } from './lib/client-error-telemetry';

type WizerWindow = Window & { __wizerErrorTelemetryInstalled?: boolean };
const recent = new Map<string, number>();
const DEDUPE_MS = 60_000;

function report(payload: ClientErrorPayload): void {
  const token = getAccessToken();
  if (!token) return;

  const now = Date.now();
  const last = recent.get(payload.fingerprint) ?? 0;
  if (now - last < DEDUPE_MS) return;
  recent.set(payload.fingerprint, now);

  void fetch(`${API_BASE_URL}/client-telemetry/error`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

if (typeof window !== 'undefined') {
  const w = window as WizerWindow;
  if (!w.__wizerErrorTelemetryInstalled) {
    w.__wizerErrorTelemetryInstalled = true;

    window.addEventListener('error', (event) => {
      const error = event.error instanceof Error ? event.error : event.message;
      report(
        buildClientErrorPayload(
          'WINDOW_ERROR',
          error,
          event.filename || undefined,
          event.lineno || undefined,
          event.colno || undefined,
        ),
      );
    });

    window.addEventListener('unhandledrejection', (event) => {
      report(buildClientErrorPayload('UNHANDLED_REJECTION', event.reason));
    });
  }
}
