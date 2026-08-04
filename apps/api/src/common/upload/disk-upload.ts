import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { diskStorage } from 'multer';

/**
 * Disk-backed multipart uploads.
 *
 * Multer's default is `memoryStorage`, which holds the ENTIRE file in the Node
 * heap for as long as the client is uploading it. With a 300 MB cap on content
 * uploads, ten concurrent uploads on a slow link is 3 GB of resident heap on a
 * 2 GB VPS — an OOM kill of the API process, taking every screen's manifest
 * poll down with it. The window is not "processing time", it is the client's
 * whole upload duration, which is exactly when it is least under our control.
 *
 * Writing to disk instead bounds heap usage to multer's stream buffers. The
 * file is then read back in two cheap passes (a 4 KB head for magic-byte
 * detection, then a streaming hash) and streamed to object storage without ever
 * being fully materialised.
 */
const logger = new Logger('DiskUpload');

/** Where multer spools incoming files. Overridable for containers with a dedicated volume. */
export const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || join(tmpdir(), 'wizer-uploads');

/** Bytes read for magic-byte type detection — every signature we check is within 12. */
export const MAGIC_BYTES = 4096;

/**
 * Multer options for a disk-spooled upload with a hard size cap.
 *
 * The filename is a random UUID, never anything client-controlled: the original
 * name reaches us as an arbitrary string and must never influence a path.
 */
export function diskUploadOptions(maxBytes: number) {
  return {
    storage: diskStorage({
      destination: (_req: unknown, _file: unknown, cb: (e: Error | null, dir: string) => void) => {
        try {
          mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
          cb(null, UPLOAD_TMP_DIR);
        } catch (error) {
          cb(error as Error, '');
        }
      },
      filename: (_req: unknown, _file: unknown, cb: (e: Error | null, name: string) => void) =>
        cb(null, `${randomUUID()}.part`),
    }),
    limits: { fileSize: maxBytes },
  };
}

/** A multipart file as it arrives from either storage engine. */
export type UploadedTempFile = {
  path?: string;
  buffer?: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

/**
 * The first {@link MAGIC_BYTES} of an upload, for content-type sniffing.
 *
 * Reads only the head — a 300 MB video must never be pulled into the heap just
 * to look at byte 0. Accepts a memory-backed file too so unit tests and the
 * smaller upload routes keep working unchanged.
 */
export async function readUploadHead(file: UploadedTempFile): Promise<Buffer> {
  if (file.buffer) return file.buffer.subarray(0, MAGIC_BYTES);
  if (!file.path) return Buffer.alloc(0);

  const handle = await open(file.path, 'r');
  try {
    const head = Buffer.alloc(MAGIC_BYTES);
    const { bytesRead } = await handle.read(head, 0, MAGIC_BYTES, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** SHA-256 of an upload, computed by streaming so memory stays constant. */
export async function hashUpload(file: UploadedTempFile): Promise<string> {
  if (file.buffer) return createHash('sha256').update(file.buffer).digest('hex');
  if (!file.path) throw new Error('Upload has neither a buffer nor a path.');

  const hash = createHash('sha256');
  const stream = createReadStream(file.path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Delete a spooled upload. Never throws: cleanup failure must not turn a
 * successful upload into a 500, and must not mask the original error when it
 * runs in a `finally` after one.
 */
export async function discardUpload(file: UploadedTempFile | undefined): Promise<void> {
  if (!file?.path) return;
  try {
    await unlink(file.path);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // ENOENT is the normal case when multer already cleaned up after an abort.
    if (err.code !== 'ENOENT') {
      logger.warn(`Could not remove spooled upload ${file.path}: ${err.message}`);
    }
  }
}
