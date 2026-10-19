import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { LinkPreview } from '@tagalong/shared';

/*
 * Link previews mean our server fetching any address someone types into the
 * chat, which is how attackers reach things that should never be reachable
 * from outside (cloud metadata at 169.254.169.254, Redis on localhost, the
 * database on the private network). So: http and https only; the address is
 * checked at connect time, on the IP actually dialled (a name that resolves
 * to a public IP when checked and a private one when fetched gets nowhere);
 * every redirect goes through the same check; and the answer is small, quick
 * and HTML, or we give up.
 */

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/i;

/** The first web address in a message, without trailing punctuation. */
export const firstUrl = (text: string): string | null => {
  const match = URL_IN_TEXT.exec(text);
  return match ? match[0].replace(/[).,!?;:'"\]]+$/, '') : null;
};

const v4Parts = (ip: string) => ip.split('.').map(Number);

const isPrivateV4 = (ip: string) => {
  const [a = 0, b = 0] = v4Parts(ip);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved, including 255.255.255.255
  );
};

/** Whether an address is on the public internet. Anything private, local or odd is refused. */
export const isPublicAddress = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return !isPrivateV4(ip);
  if (family !== 6) return false;
  const lower = ip.toLowerCase();
  // IPv4 written as IPv6 ("::ffff:127.0.0.1") is judged as the IPv4 it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return !isPrivateV4(mapped[1]!);
  if (lower === '::' || lower === '::1') return false;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:')) return false; // NAT64, documentation
  return true;
};

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Content types to accept, e.g. ["text/html"]. */
  accept?: string[];
  /** Only for tests: which addresses may be dialled. Defaults to public ones. */
  allowAddress?: (ip: string) => boolean;
  /** Only for tests: how names resolve. Defaults to the system's DNS. */
  resolve?: (host: string) => Promise<string[]>;
}

export class FetchRefused extends Error {}

const USER_AGENT = 'TagalongLinkPreview/1.0 (+https://github.com/ChandrajCJ/tagalong)';

/**
 * A guarded GET. Returns the body and final URL, or throws FetchRefused (or a
 * network error). Never sends cookies.
 */
export const safeFetch = async (
  rawUrl: string,
  options: FetchOptions = {},
): Promise<{ url: string; contentType: string; body: Buffer }> => {
  const { timeoutMs = 5_000, maxBytes = 512 * 1024, maxRedirects = 3, accept = ['text/html'] } = options;
  const allow = options.allowAddress ?? isPublicAddress;
  const deadline = Date.now() + timeoutMs;

  // Every connection, including after redirects, dials only addresses that pass the check.
  const lookup: LookupFunction = (hostname, opts, callback) => {
    const done = (err: Error | null, addresses: string[]) => {
      if (err) return callback(err, '', 0);
      const good = addresses.find(allow);
      if (!good) return callback(new FetchRefused(`Refused to connect to ${hostname}`), '', 0);
      if ((opts as { all?: boolean }).all) {
        (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
          { address: good, family: isIP(good) },
        ]);
      } else callback(null, good, isIP(good));
    };
    if (isIP(hostname)) return done(null, [hostname]);
    if (options.resolve) {
      options.resolve(hostname).then((a) => done(null, a), (e: Error) => done(e, []));
      return;
    }
    dnsLookup(hostname, { all: true }, (err, list) => done(err, (list ?? []).map((a) => a.address)));
  };

  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new FetchRefused('Only web links');
    if (parsed.username || parsed.password) throw new FetchRefused('No credentials in links');
    // A literal IP never goes through `lookup` (Node dials it directly), so check it here.
    const literal = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && !allow(literal)) throw new FetchRefused(`Refused to connect to ${literal}`);
    const left = deadline - Date.now();
    if (left <= 0) throw new FetchRefused('Timed out');

    const result = await new Promise<
      { redirect: string } | { url: string; contentType: string; body: Buffer }
    >((settle, fail) => {
      // A whole-request deadline: `timeout` alone only notices a silent socket.
      const timer = setTimeout(() => req.destroy(new FetchRefused('Timed out')), left);
      const resolve = (value: Parameters<typeof settle>[0]) => {
        clearTimeout(timer);
        settle(value);
      };
      const reject = (err: unknown) => {
        clearTimeout(timer);
        fail(err);
      };
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(
        parsed,
        {
          lookup,
          agent: false,
          timeout: left,
          headers: { 'user-agent': USER_AGENT, accept: accept.join(', '), 'accept-language': 'en' },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            return resolve({ redirect: new URL(res.headers.location, parsed).toString() });
          }
          const contentType = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
          if (status < 200 || status >= 300) {
            res.resume();
            return reject(new FetchRefused(`Answered ${status}`));
          }
          if (!accept.includes(contentType)) {
            res.resume();
            return reject(new FetchRefused(`Not ${accept.join(' or ')}`));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              // Enough to read the head of a page; for anything else, too big.
              if (contentType === 'text/html') {
                chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
                resolve({ url: parsed.toString(), contentType, body: Buffer.concat(chunks) });
              } else reject(new FetchRefused('Too big'));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ url: parsed.toString(), contentType, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new FetchRefused('Timed out')));
      req.on('error', reject);
    });

    if ('redirect' in result) {
      url = result.redirect;
      continue;
    }
    return result;
  }
  throw new FetchRefused('Too many redirects');
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (text: string) =>
  text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith('#') && name !== '#39') return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();

const attr = (tag: string, name: string) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? '') : null;
};

const clip = (text: string | null | undefined, max: number) =>
  !text ? null : text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Reads the title, description, picture and site name a page offers for sharing (Open Graph, then Twitter, then <title>). */
export const parsePreview = (html: string, pageUrl: string): LinkPreview | null => {
  const head = html.slice(0, 512 * 1024);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (key && content && !meta.has(key)) meta.set(key, decode(content));
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? (titleTag ? decode(titleTag) : null);
  const description = meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description') ?? null;
  const rawImage = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src');
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') image = resolved.toString();
    } catch {
      image = null;
    }
  }
  if (!title && !description && !image) return null;
  return {
    url: pageUrl,
    title: clip(title, 200),
    description: clip(description, 300),
    image,
    siteName: clip(meta.get('og:site_name') ?? new URL(pageUrl).hostname.replace(/^www\./, ''), 80),
  };
};
