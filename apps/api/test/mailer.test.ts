import { isPooledUrl } from '@tagalong/db';
import { describe, expect, it } from 'vitest';
import { brevoMailer, parseAddress } from '../src/lib/mailer';

const fakeFetch = (status = 201, body = '{"messageId":"<1@brevo>"}') => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe('Brevo mailer', () => {
  it('sends the sign-in code from the verified sender over HTTPS', async () => {
    const { fetch, calls } = fakeFetch();
    await brevoMailer('xkeysib-123', 'Tagalong <tagalong.app.mail@gmail.com>', { fetch }).sendLoginCode('sam@example.com', '482913');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0]!.init.headers).toMatchObject({ 'api-key': 'xkeysib-123' });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      sender: { name: 'Tagalong', email: 'tagalong.app.mail@gmail.com' },
      to: [{ email: 'sam@example.com' }],
      subject: '482913 is your Tagalong code',
    });
    expect(body.textContent).toContain('482913');
  });

  it('fails loudly when Brevo refuses, so sign-in shows an error instead of waiting forever', async () => {
    const { fetch } = fakeFetch(401, '{"code":"unauthorized","message":"Key not found"}');
    await expect(brevoMailer('wrong', 'a@b.co', { fetch }).sendLoginCode('sam@example.com', '1')).rejects.toThrow(/401.*Key not found/);
  });

  it('reads sender names and bare addresses', () => {
    expect(parseAddress('Tagalong <hi@example.com>')).toEqual({ name: 'Tagalong', email: 'hi@example.com' });
    expect(parseAddress('"Trip Bot" <bot@example.com>')).toEqual({ name: 'Trip Bot', email: 'bot@example.com' });
    expect(parseAddress('hi@example.com')).toEqual({ email: 'hi@example.com' });
  });
});

describe('database connection', () => {
  it("turns off prepared statements only behind a transaction pooler", () => {
    expect(isPooledUrl('postgres://u:p@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require')).toBe(true);
    expect(isPooledUrl('postgres://u:p@ep-cool-name-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require')).toBe(false);
    expect(isPooledUrl('postgres://u:p@localhost:5432/tagalong')).toBe(false);
  });
});
