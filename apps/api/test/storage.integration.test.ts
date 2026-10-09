import { beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { ensureBucket, s3Storage, type Storage } from '../src/lib/storage';
import { loadTestEnv } from './load-env';

/**
 * The one test that talks to real storage. Everything else uses a fake, which
 * can't catch a mismatch between our S3 client and the server (the checksum
 * header, for one). Skipped automatically when storage isn't running, so a
 * checkout without Docker up still gets a green suite.
 */
const reachable = async (endpoint: string) => {
  try {
    // Any reply means it's listening. Unsigned requests answer 403, which is
    // the server working correctly, not a server that's down.
    await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

describe('object storage', async () => {
  loadTestEnv();
  const env = loadEnv();
  const up = await reachable(env.S3_ENDPOINT);
  const maybe = up ? it : it.skip;
  let storage: Storage;

  beforeAll(async () => {
    if (!up) return;
    await ensureBucket(env);
    storage = s3Storage(env);
  });

  maybe('uploads and reads back through signed links', async () => {
    const key = `test/${crypto.randomUUID()}/boarding-pass.txt`;
    const body = 'seat 14A';

    const put = await storage.uploadUrl(key, 'text/plain', 300);
    const sent = await fetch(put, {
      method: 'PUT',
      body,
      headers: { 'content-type': 'text/plain' },
    });
    expect(sent.status).toBe(200);

    expect(await storage.sizeOf(key)).toBe(body.length);

    const get = await storage.downloadUrl(key, 'boarding pass.txt', 300);
    const read = await fetch(get);
    expect(read.status).toBe(200);
    expect(await read.text()).toBe(body);

    await storage.remove(key);
    expect(await storage.sizeOf(key)).toBeNull();
  });

  maybe('writes and reads raw bytes, as the thumbnail worker does', async () => {
    const key = `test/${crypto.randomUUID()}/thumb.webp`;
    // Bytes that aren't valid text, so nothing gets "helpfully" re-encoded.
    const body = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x7f, 0x01]);

    await storage.write(key, body, 'image/webp');
    const back = await storage.read(key);
    expect(back?.equals(body)).toBe(true);
    expect(await storage.sizeOf(key)).toBe(body.length);

    await storage.remove(key);
    expect(await storage.read(key)).toBeNull();
  });

  maybe('refuses a link whose signature was tampered with', async () => {
    const key = `test/${crypto.randomUUID()}/private.txt`;
    const put = await storage.uploadUrl(key, 'text/plain', 300);
    await fetch(put, { method: 'PUT', body: 'secret', headers: { 'content-type': 'text/plain' } });

    const get = await storage.downloadUrl(key, 'private.txt', 300);
    const tampered = await fetch(get.replace(/Signature=\w+/, 'Signature=deadbeef'));
    expect(tampered.status).toBe(403);

    await storage.remove(key);
  });

  maybe('refuses an unsigned request, so nothing in the bucket is public', async () => {
    const key = `test/${crypto.randomUUID()}/private.txt`;
    const put = await storage.uploadUrl(key, 'text/plain', 300);
    await fetch(put, { method: 'PUT', body: 'secret', headers: { 'content-type': 'text/plain' } });

    const bare = await fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`);
    expect(bare.ok).toBe(false);

    await storage.remove(key);
  });
});
