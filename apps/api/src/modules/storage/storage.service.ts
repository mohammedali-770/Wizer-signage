import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, pipeline } from 'node:stream';

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Response } from 'express';
import WebSocket from 'ws';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AppConfig } from '../../config/configuration';

const DEFAULT_SIGNED_TTL = 3600; // seconds

/**
 * Bound on any single outbound call to Supabase (Storage REST + the proxied
 * object fetch). undici's default is 300s, which is long enough that a degraded
 * provider saturates the event loop and the Prisma pool before anything fails.
 */
const UPSTREAM_FETCH_TIMEOUT_MS = Number(process.env.STORAGE_FETCH_TIMEOUT_MS ?? 15_000);

/**
 * Fraction of a signed URL's lifetime we are willing to serve from cache.
 *
 * Signing is a live HTTPS round-trip to Supabase, and the manifest resolver mints
 * one URL PER PLAYLIST ITEM, PER SCREEN, PER POLL. A 40-item playlist on 1,000
 * screens polling every 60s is ~40,000 signings/minute (~670/s) — the highest
 * amplification path in the system, and (before the timeout work) each one could
 * park a Node handle and a pooled DB connection indefinitely.
 *
 * Re-serving a cached URL is safe as long as it still has plenty of life left,
 * so we hand one out only while at least half its TTL remains. That turns the
 * per-poll cost into roughly one signing per object per half-TTL.
 */
const SIGNED_URL_CACHE_FRACTION = 0.5;

/** Hard cap on cached entries so a large library cannot grow the map unbounded. */
const SIGNED_URL_CACHE_MAX = 5_000;

/**
 * File storage abstraction with two adapters:
 *  - **supabase**: production. Uploads to a private bucket; previews via signed URLs.
 *  - **local**: dev fallback when Supabase is not configured. Writes under a local
 *    directory and serves files through an encrypted, time-limited token URL
 *    (see ContentFilesController). The interface is identical to both.
 *
 * Keys are company-scoped: companies/{companyId}/content/{contentId}/{filename}.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly mode: 'supabase' | 'local';
  private readonly bucket: string;
  private readonly localDir: string;
  private readonly apiUrl: string;
  private supabase?: SupabaseClient;
  /** key+ttl -> { url, reuseUntil }. In-process only; see getSignedUrl. */
  private readonly signedUrlCache = new Map<string, { url: string; reuseUntil: number }>();

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {
    const supabase = this.config.get<AppConfig['supabase']>('supabase', { infer: true });
    const http = this.config.get<AppConfig['http']>('http', { infer: true });
    this.bucket = supabase?.storageBucket ?? 'media';
    this.apiUrl = http?.apiUrl ?? 'http://localhost:3001';
    this.localDir = process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), '.storage');

    if (supabase?.url && supabase.serviceRoleKey && supabase.storageBucket) {
      this.mode = 'supabase';
      this.supabase = createClient(supabase.url, supabase.serviceRoleKey, {
        auth: { persistSession: false },
        global: {
          // supabase-js otherwise inherits undici's 300s default, so a slow
          // Storage API would hold every upload/signed-URL/remove call open
          // indefinitely. Every SDK call is now bounded.
          fetch: (input, init) =>
            fetch(input as Parameters<typeof globalThis.fetch>[0], {
              ...init,
              signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
            }),
        },
        // This server uses Storage only — never Realtime. supabase-js still
        // constructs a Realtime client, and @supabase/realtime-js throws on
        // Node < 22 when it can't find a native WebSocket. Supplying the `ws`
        // transport satisfies that probe (it never actually connects). ws is
        // runtime-compatible with realtime-js's WebSocketLikeConstructor; their
        // TS types differ, so cast narrowly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        realtime: { transport: WebSocket as any },
      });
      this.logger.log(`Storage: Supabase bucket "${this.bucket}".`);
    } else {
      this.mode = 'local';
      this.logger.warn(
        `Storage: local dev adapter at "${this.localDir}" (Supabase not configured).`,
      );
    }
  }

  get isLocal(): boolean {
    return this.mode === 'local';
  }

  /** Build a company-scoped storage key. */
  buildKey(companyId: string, contentId: string, filename: string): string {
    const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180) || 'file';
    return `companies/${companyId}/content/${contentId}/${safe}`;
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (this.mode === 'supabase') {
      const { error } = await this.supabase!.storage.from(this.bucket).upload(key, buffer, {
        contentType,
        upsert: true,
      });
      if (error) {
        throw new InternalServerErrorException(`Storage upload failed: ${error.message}`);
      }
    } else {
      const full = join(this.localDir, key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, buffer);
    }
  }

  /**
   * A time-limited URL the browser (or a device) can use to fetch the file.
   *
   * Cached in-process while at least half the TTL remains — see
   * SIGNED_URL_CACHE_FRACTION. The manifest path signs one URL per playlist item
   * per screen per poll, so without this the signing rate scales as
   * screens x items x poll-frequency and saturates Supabase Storage long before
   * anything else in the system becomes the bottleneck.
   */
  async getSignedUrl(key: string, mimeType: string, ttl = DEFAULT_SIGNED_TTL): Promise<string> {
    if (this.mode === 'supabase') {
      // '|' is a safe separator: buildKey sanitises filenames to [A-Za-z0-9._-]
      // and the rest of the key is a fixed companies/<uuid>/content/<uuid>/ path,
      // so it can never collide with key content. The TTL is part of the key so a
      // short-lived request never reuses a long-lived URL.
      const cacheKey = `${key}|${ttl}`;
      const cached = this.signedUrlCache.get(cacheKey);
      if (cached && cached.reuseUntil > Date.now()) {
        return cached.url;
      }

      const { data, error } = await this.supabase!.storage.from(this.bucket).createSignedUrl(
        key,
        ttl,
      );
      if (error || !data) {
        throw new InternalServerErrorException(
          `Could not sign URL: ${error?.message ?? 'unknown'}`,
        );
      }

      this.rememberSignedUrl(cacheKey, data.signedUrl, ttl);
      return data.signedUrl;
    }
    const token = this.crypto.encrypt(
      JSON.stringify({ k: key, m: mimeType, exp: Math.floor(Date.now() / 1000) + ttl }),
    );
    return `${this.apiUrl}/api/content-files/${encodeURIComponent(token)}`;
  }

  /**
   * Store a freshly-signed URL, evicting expired entries (and, if still over the
   * cap, the oldest) so the map cannot grow without bound. Map preserves
   * insertion order, so the first keys are the least recently signed.
   */
  private rememberSignedUrl(cacheKey: string, url: string, ttl: number): void {
    this.signedUrlCache.set(cacheKey, {
      url,
      reuseUntil: Date.now() + ttl * 1000 * SIGNED_URL_CACHE_FRACTION,
    });

    if (this.signedUrlCache.size <= SIGNED_URL_CACHE_MAX) return;

    const now = Date.now();
    for (const [k, v] of this.signedUrlCache) {
      if (v.reuseUntil <= now) this.signedUrlCache.delete(k);
    }
    while (this.signedUrlCache.size > SIGNED_URL_CACHE_MAX) {
      const oldest = this.signedUrlCache.keys().next().value;
      if (oldest === undefined) break;
      this.signedUrlCache.delete(oldest);
    }
  }

  async remove(key: string): Promise<void> {
    // A removed object's cached URL must not outlive it.
    for (const k of this.signedUrlCache.keys()) {
      if (k.startsWith(`${key}|`)) this.signedUrlCache.delete(k);
    }
    if (this.mode === 'supabase') {
      const { error } = await this.supabase!.storage.from(this.bucket).remove([key]);
      if (error) this.logger.warn(`Storage remove failed for ${key}: ${error.message}`);
    } else {
      try {
        await unlink(join(this.localDir, key));
      } catch {
        // Already gone — fine for cleanup.
      }
    }
  }

  /** Serve a local-adapter file via its encrypted token (local mode only). */
  async streamLocal(token: string, res: Response): Promise<void> {
    if (this.mode !== 'local') {
      throw new NotFoundException();
    }
    let payload: { k: string; m: string; exp: number };
    try {
      payload = JSON.parse(this.crypto.decrypt(decodeURIComponent(token)));
    } catch {
      throw new NotFoundException();
    }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new NotFoundException('Link expired.');
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(join(this.localDir, payload.k));
    } catch {
      throw new NotFoundException('File not found.');
    }
    res.setHeader('Content-Type', payload.m || 'application/octet-stream');
    // Defense-in-depth: never let the browser sniff a different type, and never
    // render as an active document on this API origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  }

  /**
   * Stream a stored object's bytes to a device-authenticated response (Phase 7
   * offline cache). Supports HTTP Range (resume / video). The raw Supabase
   * service role and signed URLs stay server-side — the device only ever sees
   * the bytes, never a public storage URL. The caller MUST have authorized
   * entitlement to `key` before calling this.
   */
  async streamContent(opts: {
    key: string;
    mimeType: string;
    range?: string;
    res: Response;
  }): Promise<void> {
    const { key, mimeType, range, res } = opts;
    this.setStreamHeaders(res, mimeType);

    if (this.mode === 'local') {
      const full = join(this.localDir, key);
      const info = await stat(full).catch(() => null);
      if (!info) throw new NotFoundException('File not found.');
      const total = info.size;
      const parsed = this.parseRange(range, total);
      if (parsed === 'invalid') {
        res.status(416).setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      if (parsed) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${total}`);
        res.setHeader('Content-Length', parsed.end - parsed.start + 1);
        createReadStream(full, { start: parsed.start, end: parsed.end }).pipe(res);
        return;
      }
      res.status(200);
      res.setHeader('Content-Length', total);
      createReadStream(full).pipe(res);
      return;
    }

    // Supabase: proxy the (optionally ranged) fetch of a short-lived signed URL
    // server-side; the signed URL never leaves this process.
    const signedUrl = await this.getSignedUrl(key, mimeType, 300);
    // Bound the upstream fetch. Without a signal, undici's 300s default applies
    // and a degraded Supabase Storage parks a Node handle plus a pooled DB
    // connection per in-flight download until the event loop saturates.
    const upstream = await fetch(signedUrl, {
      headers: range ? { Range: range } : {},
      signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
    });
    if (!upstream.ok && upstream.status !== 206) {
      throw new NotFoundException('File not available.');
    }
    res.status(upstream.status === 206 ? 206 : 200);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (upstream.body) {
      // pipeline(), not .pipe(): a raw pipe leaves the source Readable without
      // an 'error' handler, and an upstream error on a stream with no listener
      // is an unhandled 'error' event that takes the whole process down. It also
      // never tore down the upstream read when the client disconnected, leaking
      // a socket per aborted download.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = Readable.fromWeb(upstream.body as any);
      res.on('close', () => source.destroy());
      pipeline(source, res, (error) => {
        if (error && !res.writableEnded) {
          this.logger.warn(`Download stream failed: ${error.message}`);
          res.destroy();
        }
      });
    } else {
      res.end();
    }
  }

  private setStreamHeaders(res: Response, mimeType: string): void {
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
  }

  /** Parse a `bytes=start-end` Range header. Returns null for none, 'invalid' for unsatisfiable. */
  private parseRange(
    range: string | undefined,
    total: number,
  ): { start: number; end: number } | null | 'invalid' {
    if (!range) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return null;
    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total || start < 0) return 'invalid';
    return { start, end };
  }
}
