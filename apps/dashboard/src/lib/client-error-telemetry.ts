export type ClientErrorKind = 'WINDOW_ERROR' | 'UNHANDLED_REJECTION';

export interface ClientErrorPayload {
  kind: ClientErrorKind;
  fingerprint: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

export function sanitizeClientErrorMessage(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? 'Unknown error');
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\b\d{7,}\b/g, '<number>')
    .slice(0, 160);
}

export function sanitizeClientErrorSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  try {
    return new URL(source, 'https://wizer.invalid').pathname.slice(0, 500);
  } catch {
    return source.split(/[?#]/, 1)[0]?.slice(0, 500) || undefined;
  }
}

function hash32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function clientErrorFingerprint(seed: string): string {
  return [0x811c9dc5, 0x9e3779b1, 0x85ebca6b]
    .map((initial) => hash32(seed, initial).toString(16).padStart(8, '0'))
    .join('');
}

export function buildClientErrorPayload(
  kind: ClientErrorKind,
  error: unknown,
  source?: string,
  line?: number,
  column?: number,
): ClientErrorPayload {
  const sanitizedSource = sanitizeClientErrorSource(source);
  const raw = error instanceof Error ? `${error.name}:${error.message}` : String(error ?? 'Unknown error');
  const fingerprint = clientErrorFingerprint(
    `${kind}|${raw}|${sanitizedSource ?? ''}|${line ?? ''}|${column ?? ''}`,
  );
  return {
    kind,
    fingerprint,
    message: sanitizeClientErrorMessage(error),
    ...(sanitizedSource ? { source: sanitizedSource } : {}),
    ...(Number.isInteger(line) && (line ?? -1) >= 0 ? { line } : {}),
    ...(Number.isInteger(column) && (column ?? -1) >= 0 ? { column } : {}),
  };
}
