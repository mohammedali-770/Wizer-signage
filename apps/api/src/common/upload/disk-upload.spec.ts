import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAGIC_BYTES,
  diskUploadOptions,
  discardUpload,
  hashUpload,
  readUploadHead,
} from './disk-upload';

/**
 * Disk-spooled uploads.
 *
 * The point of this module is that a 300 MB upload never enters the Node heap.
 * These tests prove the two reads that replace `file.buffer` are equivalent to
 * the buffer they replace, that the head read is genuinely partial, and that the
 * temp file is always cleaned up.
 */
describe('disk upload helpers', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wizer-upload-test-'));
  });

  async function spool(bytes: Buffer) {
    const path = join(dir, `${randomUUID()}.part`);
    await writeFile(path, bytes);
    return {
      path,
      mimetype: 'application/octet-stream',
      originalname: 'f.bin',
      size: bytes.length,
    };
  }

  it('reads only the head of a large file, not the whole thing', async () => {
    // 5 MB — comfortably larger than MAGIC_BYTES.
    const big = Buffer.alloc(5 * 1024 * 1024, 0x41);
    big.set([0x89, 0x50, 0x4e, 0x47], 0); // PNG signature at offset 0
    const file = await spool(big);

    const head = await readUploadHead(file);
    expect(head.length).toBe(MAGIC_BYTES);
    expect(head.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('returns a short file in full without over-reading', async () => {
    const file = await spool(Buffer.from('%PDF-1.7\n'));
    const head = await readUploadHead(file);
    expect(head.toString()).toBe('%PDF-1.7\n');
  });

  it('hashes a disk-spooled file identically to hashing its buffer', async () => {
    const bytes = Buffer.from('the quick brown fox'.repeat(10_000));
    const file = await spool(bytes);

    const expected = createHash('sha256').update(bytes).digest('hex');
    await expect(hashUpload(file)).resolves.toBe(expected);
    // ...and the memory-backed shape still works, so existing callers are safe.
    await expect(hashUpload({ ...file, path: undefined, buffer: bytes })).resolves.toBe(expected);
  });

  it('reads the head of a memory-backed file too', async () => {
    const bytes = Buffer.alloc(MAGIC_BYTES * 2, 0x42);
    const head = await readUploadHead({
      buffer: bytes,
      mimetype: 'x',
      originalname: 'f',
      size: bytes.length,
    });
    expect(head.length).toBe(MAGIC_BYTES);
  });

  it('deletes the spooled file', async () => {
    const file = await spool(Buffer.from('temp'));
    expect(existsSync(file.path)).toBe(true);
    await discardUpload(file);
    expect(existsSync(file.path)).toBe(false);
  });

  it('never throws when the file is already gone', async () => {
    const file = await spool(Buffer.from('temp'));
    await discardUpload(file);
    await expect(discardUpload(file)).resolves.toBeUndefined();
    await expect(discardUpload(undefined)).resolves.toBeUndefined();
  });

  it('names spooled files randomly — the client filename never reaches the path', async () => {
    const options = diskUploadOptions(1024);
    const filename = (
      options.storage as unknown as {
        getFilename: (
          req: unknown,
          file: unknown,
          cb: (e: Error | null, name: string) => void,
        ) => void;
      }
    ).getFilename;

    const names = await Promise.all(
      ['../../etc/passwd', 'a.png', 'a.png'].map(
        (originalname) =>
          new Promise<string>((resolve, reject) =>
            filename({}, { originalname }, (e, name) => (e ? reject(e) : resolve(name))),
          ),
      ),
    );

    for (const name of names) {
      expect(name).toMatch(/^[0-9a-f-]{36}\.part$/);
      expect(name).not.toContain('/');
    }
    // Two uploads of the same filename must not collide.
    expect(new Set(names).size).toBe(3);
  });

  it('applies the size cap it is given', () => {
    expect(diskUploadOptions(300 * 1024 * 1024).limits.fileSize).toBe(300 * 1024 * 1024);
  });

  it('writes into the configured spool directory', async () => {
    const options = diskUploadOptions(1024);
    const destination = (
      options.storage as unknown as {
        getDestination: (
          req: unknown,
          file: unknown,
          cb: (e: Error | null, dir: string) => void,
        ) => void;
      }
    ).getDestination;

    const target = await new Promise<string>((resolve, reject) =>
      destination({}, {}, (e, d) => (e ? reject(e) : resolve(d))),
    );
    expect(existsSync(target)).toBe(true);
  });

  it('round-trips content through the spool unchanged', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x89, 0x50]);
    const file = await spool(bytes);
    expect(await readFile(file.path)).toEqual(bytes);
  });
});
