import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  /**
   * The spool being unusable is not hypothetical — it shipped.
   *
   * UPLOAD_TMP_DIR is a named volume; Docker created its mountpoint root:root
   * while the API runs as uid 1000. `mkdirSync(dir,{recursive:true})` SUCCEEDS
   * on an existing directory you cannot write to, so the destination callback
   * returned cleanly and multer's write stream then failed with a bare EACCES.
   * That is not a MulterError, so every upload became a generic 500 while URL
   * content kept working — and nothing in the suite noticed, because nothing
   * exercised this callback against a spool it could not use.
   */
  describe('when the spool is unusable', () => {
    const getDestination = (): ((
      req: unknown,
      file: unknown,
      cb: (e: Error | null, dir: string) => void,
    ) => void) =>
      (
        diskUploadOptions(1024).storage as unknown as {
          getDestination: (
            req: unknown,
            file: unknown,
            cb: (e: Error | null, dir: string) => void,
          ) => void;
        }
      ).getDestination;

    const callDestination = (): Promise<{ err: Error | null; dir: string }> =>
      new Promise((resolve) => getDestination()({}, {}, (err, dir) => resolve({ err, dir })));

    const ORIGINAL = process.env.UPLOAD_TMP_DIR;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.UPLOAD_TMP_DIR;
      else process.env.UPLOAD_TMP_DIR = ORIGINAL;
      jest.resetModules();
    });

    it('reports an error instead of handing multer a directory it cannot create', async () => {
      // A path whose PARENT is a regular file: mkdirSync cannot create it, and
      // unlike a permissions test this behaves identically for root and non-root.
      const base = await mkdtemp(join(tmpdir(), 'wizer-spool-'));
      const notADir = join(base, 'i-am-a-file');
      await writeFile(notADir, 'x');
      process.env.UPLOAD_TMP_DIR = join(notADir, 'nested');
      jest.resetModules();
      const { diskUploadOptions: fresh } =
        (await import('./disk-upload')) as typeof import('./disk-upload');

      const result = await new Promise<{ err: Error | null; dir: string }>((resolve) =>
        (
          fresh(1024).storage as unknown as {
            getDestination: (
              r: unknown,
              f: unknown,
              cb: (e: Error | null, d: string) => void,
            ) => void;
          }
        ).getDestination({}, {}, (err, dir) => resolve({ err, dir })),
      );

      // Not toBeInstanceOf(Error): constructor identity differs across a
      // jest.resetModules() dynamic import. The contract is what matters — an
      // error is reported and no directory is handed to multer.
      expect(result.err).toBeTruthy();
      expect((result.err as NodeJS.ErrnoException).code).toBeDefined();
      expect(result.dir).toBe('');
    });

    it('rejects a directory that exists but is not writable', async () => {
      if (process.getuid?.() === 0) {
        // Root bypasses the W_OK check entirely, so this assertion would pass
        // without proving anything. Skipping loudly beats a vacuous green.
        console.warn('skipped: running as root, which bypasses W_OK');
        return;
      }
      const dir = await mkdtemp(join(tmpdir(), 'wizer-spool-ro-'));
      await chmod(dir, 0o555);
      process.env.UPLOAD_TMP_DIR = dir;
      jest.resetModules();
      const { diskUploadOptions: fresh } =
        (await import('./disk-upload')) as typeof import('./disk-upload');

      const result = await new Promise<{ err: Error | null; dir: string }>((resolve) =>
        (
          fresh(1024).storage as unknown as {
            getDestination: (
              r: unknown,
              f: unknown,
              cb: (e: Error | null, d: string) => void,
            ) => void;
          }
        ).getDestination({}, {}, (err, dir2) => resolve({ err, dir: dir2 })),
      );

      await chmod(dir, 0o755);
      expect(result.err).toBeTruthy();
      expect(result.dir).toBe('');
    });

    it('still accepts a spool it can write to', async () => {
      const result = await callDestination();
      expect(result.err).toBeNull();
      expect(existsSync(result.dir)).toBe(true);
    });
  });

  it('round-trips content through the spool unchanged', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x89, 0x50]);
    const file = await spool(bytes);
    expect(await readFile(file.path)).toEqual(bytes);
  });
});
