import { StorageService } from './storage.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Signed-URL caching.
 *
 * The manifest resolver mints one signed URL per playlist item, per screen, per
 * poll. A 40-item playlist on 1,000 screens polling every 60s is ~40,000
 * signings/minute (~670/s) against Supabase Storage — the highest amplification
 * path in the system. These tests pin that the cache collapses that rate without
 * ever handing out a URL that is close to expiry.
 */
describe('StorageService signed-URL cache', () => {
  const TTL = 3600;

  function build() {
    const createSignedUrl = jest.fn((key: string) =>
      Promise.resolve({
        data: { signedUrl: `https://signed.example/${key}?sig=${Math.random()}` },
        error: null,
      }),
    );
    const remove = jest.fn(() => Promise.resolve({ error: null }));
    const supabase = { storage: { from: () => ({ createSignedUrl, remove }) } };

    const config = {
      get: (section: string) =>
        section === 'supabase'
          ? { url: 'https://p.supabase.co', serviceRoleKey: 'k', storageBucket: 'media' }
          : { apiUrl: 'http://api:3001' },
    };
    const service = new StorageService(config as any, { encrypt: (v: string) => v } as any);
    // Replace the real client; construction already selected 'supabase' mode.
    (service as any).supabase = supabase;
    return { service, createSignedUrl, remove };
  }

  it('signs once and reuses the URL for subsequent requests', async () => {
    const t = build();
    const a = await t.service.getSignedUrl('companies/c1/content/x/a.jpg', 'image/jpeg', TTL);
    const b = await t.service.getSignedUrl('companies/c1/content/x/a.jpg', 'image/jpeg', TTL);

    expect(a).toBe(b);
    expect(t.createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('collapses a whole fleet poll into one signing per object', async () => {
    const t = build();
    // 40-item playlist fetched by 50 screens = 2,000 logical requests.
    const keys = Array.from({ length: 40 }, (_, i) => `companies/c1/content/${i}/f.mp4`);
    for (let screen = 0; screen < 50; screen++) {
      for (const key of keys) {
        await t.service.getSignedUrl(key, 'video/mp4', TTL);
      }
    }
    // Without the cache this is 2,000 live HTTPS round-trips.
    expect(t.createSignedUrl).toHaveBeenCalledTimes(40);
  });

  it('keys the cache per object — different files never share a URL', async () => {
    const t = build();
    const a = await t.service.getSignedUrl('a.jpg', 'image/jpeg', TTL);
    const b = await t.service.getSignedUrl('b.jpg', 'image/jpeg', TTL);
    expect(a).not.toBe(b);
    expect(t.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('keys the cache per TTL — a short-lived request never reuses a long-lived URL', async () => {
    const t = build();
    await t.service.getSignedUrl('a.jpg', 'image/jpeg', TTL);
    await t.service.getSignedUrl('a.jpg', 'image/jpeg', 300);
    expect(t.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('re-signs once the reuse window has passed, well before the URL expires', async () => {
    const t = build();
    await t.service.getSignedUrl('a.jpg', 'image/jpeg', TTL);

    // Advance past the reuse window (half the TTL) but nowhere near expiry.
    const cache = (t.service as any).signedUrlCache as Map<string, { reuseUntil: number }>;
    for (const entry of cache.values()) entry.reuseUntil = Date.now() - 1;

    await t.service.getSignedUrl('a.jpg', 'image/jpeg', TTL);
    expect(t.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('never serves a URL for an object that has been removed', async () => {
    const t = build();
    const before = await t.service.getSignedUrl('gone.jpg', 'image/jpeg', TTL);
    await t.service.remove('gone.jpg');
    const after = await t.service.getSignedUrl('gone.jpg', 'image/jpeg', TTL);

    expect(after).not.toBe(before); // stale entry was evicted
    expect(t.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('bounds the cache so a large library cannot grow it without limit', async () => {
    const t = build();
    for (let i = 0; i < 5_200; i++) {
      await t.service.getSignedUrl(`f${i}.jpg`, 'image/jpeg', TTL);
    }
    const cache = (t.service as any).signedUrlCache as Map<string, unknown>;
    expect(cache.size).toBeLessThanOrEqual(5_000);
  });
});
