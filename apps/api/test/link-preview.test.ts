import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { messages } from '@tagalong/db';
import type { ChatMessage, LinkPreview, TripEvent } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewCacheKey, processLinkPreview } from '../src/jobs/preview';
import { FetchRefused, firstUrl, isPublicAddress, parsePreview, safeFetch, type FetchOptions } from '../src/lib/link-preview';
import { bearer, createTrip, useTestApp } from './helpers';

const OG_PAGE = `<!doctype html><html><head>
  <title>Fallback title</title>
  <meta property="og:title" content="Casa do Mar &amp; Suites">
  <meta property="og:description" content="Rooms by the sea in Lisbon">
  <meta property="og:image" content="/img/front.jpg">
  <meta property="og:site_name" content="Casa do Mar">
</head><body>hi</body></html>`;

const TWITTER_PAGE = `<html><head>
  <meta name="twitter:title" content="A tweetable page">
  <meta name="twitter:image" content="https://cdn.example.com/card.png">
  <meta name="description" content="Plain description">
</head></html>`;

describe('finding and reading links', () => {
  it('finds the first link, without trailing punctuation', () => {
    expect(firstUrl('Booked! (https://example.com/hotel?id=3).')).toBe('https://example.com/hotel?id=3');
    expect(firstUrl('no links')).toBeNull();
  });

  it('reads Open Graph tags, resolving the picture against the page', () => {
    expect(parsePreview(OG_PAGE, 'https://casa.example/rooms')).toEqual({
      url: 'https://casa.example/rooms',
      title: 'Casa do Mar & Suites',
      description: 'Rooms by the sea in Lisbon',
      image: 'https://casa.example/img/front.jpg',
      siteName: 'Casa do Mar',
    });
  });

  it('falls back to Twitter tags, the description and the host name', () => {
    expect(parsePreview(TWITTER_PAGE, 'https://www.tweety.example/x')).toEqual({
      url: 'https://www.tweety.example/x',
      title: 'A tweetable page',
      description: 'Plain description',
      image: 'https://cdn.example.com/card.png',
      siteName: 'tweety.example',
    });
    expect(parsePreview('<html><body>nothing</body></html>', 'https://a.example')).toBeNull();
  });

  it('refuses private, loopback and link-local addresses, IPv6 included', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('the guarded fetch', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      const html = (body: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      };
      switch (req.url) {
        case '/og':
          return html(OG_PAGE);
        case '/to-og':
          res.writeHead(302, { location: '/og' });
          return res.end();
        case '/to-metadata':
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
          return res.end();
        case '/to-private-name':
          res.writeHead(302, { location: `http://inside.test:${port}/og` });
          return res.end();
        case '/loop':
          res.writeHead(302, { location: '/loop' });
          return res.end();
        case '/json':
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end('{"og:title":"nope"}');
        case '/huge':
          // The tags come after the first 512 KB, so they're never read.
          return html(`<html><head>${' '.repeat(600 * 1024)}${OG_PAGE}`);
        case '/slow':
          setTimeout(() => html(OG_PAGE), 2_000);
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  /** "site.test" stands in for a public site (it's our local server); "inside.test" for a private one. */
  const options: FetchOptions = {
    resolve: async (host) => (host === 'site.test' ? ['127.0.0.1'] : host === 'inside.test' ? ['10.0.0.5'] : []),
    allowAddress: (ip) => ip === '127.0.0.1',
    timeoutMs: 500,
  };
  const site = (path: string) => `http://site.test:${port}${path}`;

  it('fetches a page and follows a redirect', async () => {
    const page = await safeFetch(site('/to-og'), options);
    expect(page.url).toBe(site('/og'));
    expect(page.body.toString()).toContain('og:title');
  });

  it('refuses private addresses, by default and after a redirect', async () => {
    await expect(safeFetch(site('/og'))).rejects.toThrow();
    await expect(safeFetch(`http://127.0.0.1:${port}/og`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(`http://[::1]:${port}/og`)).rejects.toBeInstanceOf(FetchRefused);
    // 2130706433 is 127.0.0.1 written as one number.
    await expect(safeFetch(`http://2130706433:${port}/og`)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(site('/to-metadata'), options)).rejects.toBeInstanceOf(FetchRefused);
    await expect(safeFetch(site('/to-private-name'), options)).rejects.toBeInstanceOf(FetchRefused);
  });

  it('gives up on endless redirects, slow pages, other content and other schemes', async () => {
    await expect(safeFetch(site('/loop'), options)).rejects.toThrow('Too many redirects');
    await expect(safeFetch(site('/slow'), options)).rejects.toThrow('Timed out');
    await expect(safeFetch(site('/json'), options)).rejects.toThrow('Not text/html');
    await expect(safeFetch('file:///etc/passwd', options)).rejects.toThrow('Only web links');
  });

  it('reads at most 512 KB of a page', async () => {
    const page = await safeFetch(site('/huge'), options);
    expect(page.body.length).toBe(512 * 1024);
    expect(parsePreview(page.body.toString(), page.url)).toBeNull();
  });

  describe('the worker job', () => {
    const t = useTestApp();

    let listener: Redis;
    const events: TripEvent[] = [];
    beforeAll(async () => {
      listener = new Redis(process.env.REDIS_URL!);
      await listener.psubscribe('trip:*');
      listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
    });
    afterAll(() => listener.disconnect());

    const post = async (token: string, tripId: string, body: string) =>
      (
        await t.app.inject({ method: 'POST', url: `/trips/${tripId}/messages`, headers: bearer(token), payload: { body } })
      ).json<ChatMessage>();

    it('attaches the preview, announces it, and reuses it from the cache', async () => {
      const owner = await t.signIn('owner@example.com');
      const tripId = await createTrip(t.app, owner.accessToken);
      await t.redis.del(previewCacheKey(site('/og')));
      const first = await post(owner.accessToken, tripId, `Look ${site('/og')}`);
      events.length = 0;
      hits.length = 0;

      const result = await processLinkPreview({ db: t.db, redis: t.redis, fetchOptions: options }, { messageId: first.id });
      expect(result).toMatchObject({ cached: false, added: { title: 'Casa do Mar & Suites', url: site('/og') } });
      const [row] = await t.db.select().from(messages).where(eq(messages.id, first.id));
      expect((row!.payload as { preview: LinkPreview }).preview.image).toBe(`http://site.test:${port}/img/front.jpg`);
      await new Promise((r) => setTimeout(r, 100));
      expect(events.filter((e) => e.type === 'message.updated').map((e) => (e.payload as ChatMessage).payload)).toEqual([
        { preview: expect.objectContaining({ siteName: 'Casa do Mar' }) },
      ]);

      const second = await post(owner.accessToken, tripId, `Same place ${site('/og')}`);
      const again = await processLinkPreview({ db: t.db, redis: t.redis, fetchOptions: options }, { messageId: second.id });
      expect(again).toMatchObject({ cached: true });
      expect(hits).toEqual(['/og']);
    });

    it('skips links to the app itself', async () => {
      const owner = await t.signIn('owner@example.com');
      const tripId = await createTrip(t.app, owner.accessToken);
      const invite = await post(owner.accessToken, tripId, 'Join us https://tagalong.example/invite/abc');
      const result = await processLinkPreview(
        { db: t.db, redis: t.redis, ownHosts: ['tagalong.example'], fetchOptions: options },
        { messageId: invite.id },
      );
      expect(result).toEqual({ skipped: 'own_app' });
    });
  });
});
