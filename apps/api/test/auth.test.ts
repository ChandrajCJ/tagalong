import { describe, expect, it } from 'vitest';
import { bearer, useTestApp } from './helpers';

describe('email sign-in', () => {
  const t = useTestApp();
  const email = 'maya@example.com';

  it('signs in with the emailed code and returns the new user', async () => {
    const tokens = await t.signIn(email);
    expect(tokens.accessToken).toBeTruthy();

    const me = await t.app.inject({ method: 'GET', url: '/me', headers: bearer(tokens.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email, displayName: 'maya' });
  });

  it('normalizes the email address', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/auth/email/request-code',
      payload: { email: '  Maya@Example.COM ' },
    });
    expect(t.codes.get(email)).toMatch(/^\d{6}$/);
  });

  it('rejects a wrong code', async () => {
    await t.app.inject({ method: 'POST', url: '/auth/email/request-code', payload: { email } });
    const wrong = t.codes.get(email) === '000000' ? '111111' : '000000';
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/email/verify',
      payload: { email, code: wrong },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('does not accept the same code twice', async () => {
    await t.signIn(email);
    const again = await t.app.inject({
      method: 'POST',
      url: '/auth/email/verify',
      payload: { email, code: t.codes.get(email) },
    });
    expect(again.statusCode).toBe(400);
  });

  it('rotates refresh tokens and rejects the old one', async () => {
    const first = await t.signIn(email);
    const refreshed = await t.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);

    const reused = await t.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('rejects requests without a valid token', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/me', headers: bearer('garbage') });
    expect(res.statusCode).toBe(401);
  });
});
