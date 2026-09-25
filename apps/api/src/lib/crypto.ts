import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const randomToken = () => randomBytes(32).toString('base64url');

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
