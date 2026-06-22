import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Response } from 'express';

import { CryptoService } from '../../common/crypto/crypto.service';
import type { AppConfig } from '../../config/configuration';

const DEFAULT_SIGNED_TTL = 3600; // seconds

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

  /** A time-limited URL the browser can use to preview/download the file. */
  async getSignedUrl(key: string, mimeType: string, ttl = DEFAULT_SIGNED_TTL): Promise<string> {
    if (this.mode === 'supabase') {
      const { data, error } = await this.supabase!.storage.from(this.bucket).createSignedUrl(
        key,
        ttl,
      );
      if (error || !data) {
        throw new InternalServerErrorException(
          `Could not sign URL: ${error?.message ?? 'unknown'}`,
        );
      }
      return data.signedUrl;
    }
    const token = this.crypto.encrypt(
      JSON.stringify({ k: key, m: mimeType, exp: Math.floor(Date.now() / 1000) + ttl }),
    );
    return `${this.apiUrl}/api/content-files/${encodeURIComponent(token)}`;
  }

  async remove(key: string): Promise<void> {
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
    const upstream = await fetch(signedUrl, { headers: range ? { Range: range } : {} });
    if (!upstream.ok && upstream.status !== 206) {
      throw new NotFoundException('File not available.');
    }
    res.status(upstream.status === 206 ? 206 : 200);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (upstream.body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(upstream.body as any).pipe(res);
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
