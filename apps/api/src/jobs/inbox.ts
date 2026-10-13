import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { bookingImports, tripMembers, trips, users, type Db } from '@tagalong/db';
import { MAX_DOCUMENT_BYTES } from '@tagalong/shared';
import { ImapFlow } from 'imapflow';
import type { Redis } from 'ioredis';
import { simpleParser, type AddressObject } from 'mailparser';
import { findBookings, pdfText, type Candidate } from '../lib/booking-import';
import type { Storage } from '../lib/storage';
import { storeDocument } from '../modules/documents/store';
import { recordImport } from '../modules/imports/record';

/**
 * Bookings by email: confirmations forwarded to the trip's address land in
 * one Gmail inbox, which the worker reads every couple of minutes. Only mail
 * from someone who can edit the trip, and that their own provider vouches
 * for (DKIM or SPF), is read; everything still waits for review.
 */

export const INBOX_QUEUE = 'inbox';

/** The inbox, as the job needs it. IMAP in real life, a list in tests. */
export interface Mailbox {
  /** Unread messages, as raw email. */
  unread(): Promise<{ uid: number; source: Buffer }[]>;
  markRead(uid: number): Promise<void>;
  close(): Promise<void>;
}

/** imaps://user:app-password@imap.gmail.com:993 */
export const imapMailbox = async (url: string): Promise<Mailbox> => {
  const u = new URL(url);
  const client = new ImapFlow({
    host: u.hostname,
    port: Number(u.port || 993),
    secure: u.protocol !== 'imap:',
    auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  return {
    async unread() {
      const out: { uid: number; source: Buffer }[] = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true, source: true }, { uid: true })) {
        if (msg.source) out.push({ uid: msg.uid, source: msg.source });
        // A burst of mail is read over a few runs, not all at once.
        if (out.length >= 25) break;
      }
      return out;
    },
    async markRead(uid) {
      await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true });
    },
    async close() {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
};

const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() ?? '';
/** "mail.example.com" is covered by a signature from "example.com". */
const covers = (signer: string, domain: string) => domain === signer || domain.endsWith(`.${signer}`);

/**
 * Did the sender's own provider vouch for this mail? Read from the
 * Authentication-Results our receiving server (`authservId`, e.g.
 * mx.google.com) added. Headers from anyone else can be forged, so they're
 * ignored. DKIM must be signed for the From domain; SPF must be for it too.
 */
export const senderVerified = (headers: string[], fromAddress: string, authservId: string) => {
  const domain = domainOf(fromAddress);
  if (!domain) return false;
  const ours = headers.find((h) => h.trim().toLowerCase().startsWith(authservId.toLowerCase()));
  if (!ours) return false;
  const results = ours.split(';').slice(1).map((r) => r.trim().toLowerCase());
  return results.some((r) => {
    const dkim = /^dkim=pass\b/.test(r) && (/header\.d=([^\s;]+)/.exec(r)?.[1] ?? /header\.i=@?([^\s;]+)/.exec(r)?.[1]);
    if (dkim) return covers(dkim.replace(/^@/, ''), domain);
    if (/^spf=pass\b/.test(r)) {
      const mailFrom = /smtp\.mailfrom=([^\s;]+)/.exec(r)?.[1];
      return !!mailFrom && covers(mailFrom.includes('@') ? domainOf(mailFrom) : mailFrom, domain);
    }
    return false;
  });
};

/** The "+code" the mail was sent to, from the addresses it was delivered to. */
export const inboxCodeIn = (addresses: string[], inboxAddress: string) => {
  const [local, domain] = inboxAddress.toLowerCase().split('@');
  const base = local!.split('+')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${base}\\+([a-z0-9]+)@${domain!.replace(/\./g, '\\.')}$`);
  for (const a of addresses) {
    const m = re.exec(a.trim().toLowerCase());
    if (m) return m[1]!;
  }
  return null;
};

const addressesOf = (field: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(field) ? field : field ? [field] : []).flatMap((f) => f.value.map((v) => v.address ?? '')).filter(Boolean);

const headerLines = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];

export type InboxOutcome =
  | { result: 'added'; tripId: string; importId: string; candidates: number }
  | { result: 'ignored'; reason: 'duplicate' | 'unknown_trip' | 'not_a_member' | 'not_verified' | 'unreadable' };

interface InboxDeps {
  db: Db;
  redis: Redis;
  storage: Storage;
  mailbox: Mailbox;
  /** The inbox's own address, e.g. tagalong.inbox@gmail.com. */
  inboxAddress: string;
  /** Whose Authentication-Results to trust. Gmail's is mx.google.com. */
  authservId?: string;
  log?: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

/** Reads one forwarded email into a trip's imports, or says why not. */
const readOne = async (deps: InboxDeps, source: Buffer): Promise<InboxOutcome> => {
  const { db, redis, storage } = deps;
  const mail = await simpleParser(source).catch(() => null);
  if (!mail) return { result: 'ignored', reason: 'unreadable' };

  const messageId = mail.messageId ?? null;
  if (messageId) {
    const [seen] = await db.select({ id: bookingImports.id }).from(bookingImports).where(eq(bookingImports.messageId, messageId));
    if (seen) return { result: 'ignored', reason: 'duplicate' };
  }

  const delivered = [
    ...addressesOf(mail.to),
    ...addressesOf(mail.cc),
    ...headerLines(mail.headers.get('delivered-to')),
    ...headerLines(mail.headers.get('x-original-to')),
  ];
  const code = inboxCodeIn(delivered, deps.inboxAddress);
  const [trip] = code
    ? await db
        .select({ id: trips.id, timezone: trips.timezone })
        .from(trips)
        .where(and(eq(trips.inboxCode, code), isNull(trips.deletedAt)))
    : [];
  if (!trip) return { result: 'ignored', reason: 'unknown_trip' };

  const from = addressesOf(mail.from)[0]?.toLowerCase() ?? '';
  const [member] = from
    ? await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .where(
          and(
            eq(tripMembers.tripId, trip.id),
            isNull(tripMembers.leftAt),
            inArray(tripMembers.role, ['owner', 'editor']),
            sql`lower(${users.email}) = ${from}`,
          ),
        )
    : [];
  if (!member) return { result: 'ignored', reason: 'not_a_member' };

  const auth = headerLines(mail.headers.get('authentication-results'));
  if (!senderVerified(auth, from, deps.authservId ?? 'mx.google.com')) return { result: 'ignored', reason: 'not_verified' };

  const receivedAt = mail.date ?? new Date();
  let candidates: Candidate[] = findBookings({
    html: typeof mail.html === 'string' ? mail.html : null,
    text: mail.text ?? null,
    receivedAt,
    timezone: trip.timezone,
  });

  // Ticket PDFs go to Docs either way; if the email itself said nothing useful, they're read too.
  let documentId: string | null = null;
  for (const file of mail.attachments.filter((a) => a.contentType === 'application/pdf' && a.size <= MAX_DOCUMENT_BYTES).slice(0, 3)) {
    const doc = await storeDocument(db, redis, storage, {
      tripId: trip.id,
      uploadedBy: member.userId,
      name: file.filename ?? 'Ticket.pdf',
      contentType: 'application/pdf',
      body: file.content,
      kind: 'ticket',
    });
    documentId ??= doc.id;
    if (candidates.length === 0) {
      const text = await pdfText(file.content);
      if (text) candidates = findBookings({ text, receivedAt, timezone: trip.timezone });
    }
  }

  const { import: found } = await recordImport(db, redis, {
    tripId: trip.id,
    source: 'email',
    createdBy: member.userId,
    fromAddress: from,
    subject: mail.subject ?? null,
    receivedAt,
    candidates,
    documentId,
    messageId,
  });
  return { result: 'added', tripId: trip.id, importId: found.id, candidates: found.candidates.length };
};

/**
 * One run: every unread email is read once and marked read, whether or not
 * it became an import, so a bad email can't be retried forever.
 */
export const processInbox = async (deps: InboxDeps): Promise<InboxOutcome[]> => {
  const outcomes: InboxOutcome[] = [];
  for (const { uid, source } of await deps.mailbox.unread()) {
    let outcome: InboxOutcome;
    try {
      outcome = await readOne(deps, source);
    } catch (err) {
      deps.log?.warn({ err, uid }, 'Could not read a forwarded email');
      outcome = { result: 'ignored', reason: 'unreadable' };
    }
    if (outcome.result === 'ignored') deps.log?.info({ uid, reason: outcome.reason }, 'Ignored a forwarded email');
    outcomes.push(outcome);
    await deps.mailbox.markRead(uid);
  }
  return outcomes;
};
