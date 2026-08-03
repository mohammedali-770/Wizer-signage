import { existsSync } from 'node:fs';
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UploadSpoolService } from './upload-spool.service';

const HOUR = 60 * 60 * 1000;

describe('UploadSpoolService', () => {
  const service = new UploadSpoolService();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wizer-spool-test-'));
  });

  async function write(name: string, ageMs = 0) {
    const path = join(dir, name);
    await writeFile(path, 'x');
    if (ageMs > 0) {
      const when = new Date(Date.now() - ageMs);
      await utimes(path, when, when);
    }
    return path;
  }

  it('removes spool files left behind by a crashed process', async () => {
    const orphan = await write('old.part', 12 * HOUR);
    await expect(service.sweep(dir)).resolves.toBe(1);
    expect(existsSync(orphan)).toBe(false);
  });

  it('leaves an in-flight upload alone', async () => {
    const live = await write('fresh.part');
    await expect(service.sweep(dir)).resolves.toBe(0);
    expect(existsSync(live)).toBe(true);
  });

  it('only ever touches .part files', async () => {
    const other = await write('important.txt', 12 * HOUR);
    await expect(service.sweep(dir)).resolves.toBe(0);
    expect(existsSync(other)).toBe(true);
  });

  it('is a no-op when the spool directory does not exist', async () => {
    await expect(service.sweep(join(dir, 'nope'))).resolves.toBe(0);
  });

  it('runs at bootstrap without throwing', async () => {
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
