import { describe, expect, it } from 'vitest';
import { s3Storage } from '../src/lib/storage';

const env = {
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'tagalong',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

describe('signed storage links', () => {
  it('are signed for the address phones use, when that differs from ours', async () => {
    // "localhost" on a phone is the phone itself, so its links need the LAN address.
    const storage = s3Storage({ ...env, S3_PUBLIC_ENDPOINT: 'http://10.0.0.9:8333' });
    expect(await storage.uploadUrl('a/b.jpg', 'image/jpeg', 60)).toMatch(/^http:\/\/10\.0\.0\.9:8333\/tagalong\/a\/b\.jpg\?/);
    expect(await storage.downloadUrl('a/b.jpg', 'b.jpg', 60)).toMatch(/^http:\/\/10\.0\.0\.9:8333\//);
  });

  it('use our own address when no public one is set', async () => {
    const storage = s3Storage(env);
    expect(await storage.uploadUrl('a/b.jpg', 'image/jpeg', 60)).toMatch(/^http:\/\/localhost:8333\//);
  });
});
