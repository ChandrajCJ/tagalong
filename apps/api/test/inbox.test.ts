import { bookingImports, documents, messages, trips } from '@tagalong/db';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { processInbox, type Mailbox } from '../src/jobs';
import { inboxCodeIn, senderVerified } from '../src/jobs/inbox';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const INBOX = 'tagalong.inbox@gmail.com';
const CODE = 'k3x9q2m7tz';
const GOOD_AUTH = (from: string) =>
  `mx.google.com; dkim=pass header.i=@${from.split('@')[1]} header.s=20230601 header.b=abc; spf=pass (google.com: domain of ${from} designates 1.2.3.4 as permitted sender) smtp.mailfrom=${from}; dmarc=pass`;

/** A raw email as the inbox would hold it. */
const email = (o: {
  from: string;
  to?: string;
  id?: string;
  auth?: string[];
  subject?: string;
  text?: string;
  pdf?: Buffer;
}) => {
  const head = [
    ...(o.auth ?? [GOOD_AUTH(o.from)]).map((a) => `Authentication-Results: ${a}`),
    `From: Sam Mehta <${o.from}>`,
    `To: ${o.to ?? `tagalong.inbox+${CODE}@gmail.com`}`,
    `Subject: ${o.subject ?? 'Fwd: IndiGo - Your booking is confirmed'}`,
    `Message-ID: <${o.id ?? `${Math.random().toString(36).slice(2)}@mail.gmail.com`}>`,
    'Date: Wed, 20 May 2026 10:00:00 +0530',
    'MIME-Version: 1.0',
  ];
  const text = o.text ?? readFileSync(new URL('./fixtures/booking-emails/indigo-return.txt', import.meta.url), 'utf8');
  if (!o.pdf) return Buffer.from([...head, 'Content-Type: text/plain; charset=utf-8', '', text].join('\r\n'));
  return Buffer.from(
    [
      ...head,
      'Content-Type: multipart/mixed; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '--XYZ',
      'Content-Type: application/pdf; name="ticket.pdf"',
      'Content-Disposition: attachment; filename="ticket.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      o.pdf.toString('base64').replace(/.{76}/g, '$&\r\n'),
      '--XYZ--',
      '',
    ].join('\r\n'),
  );
};

/** A mailbox holding these emails, remembering which were marked read. */
const fakeMailbox = (sources: Buffer[]) => {
  const read: number[] = [];
  const mailbox: Mailbox = {
    async unread() {
      return sources.map((source, i) => ({ uid: i + 1, source })).filter((m) => !read.includes(m.uid));
    },
    async markRead(uid) {
      read.push(uid);
    },
    async close() {},
  };
  return { mailbox, read };
};

describe('bookings forwarded by email', () => {
  const t = useTestApp();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    await t.db.update(trips).set({ inboxCode: CODE }).where(eq(trips.id, tripId));
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@gmail.com');
    return { owner, sam, tripId };
  };
  const run = (sources: Buffer[]) => {
    const box = fakeMailbox(sources);
    return { box, outcomes: processInbox({ db: t.db, redis: t.redis, storage: t.storage, mailbox: box.mailbox, inboxAddress: INBOX }) };
  };

  it('reads mail from an editor into an import to review, with a card in chat', async () => {
    const { tripId, sam, owner } = await setup();
    const { box, outcomes } = run([email({ from: 'Sam@Gmail.com' })]);
    expect(await outcomes).toEqual([{ result: 'added', tripId, importId: expect.any(String), candidates: 2 }]);
    expect(box.read).toEqual([1]);

    const [row] = await t.db.select().from(bookingImports).where(eq(bookingImports.tripId, tripId));
    expect(row).toMatchObject({ source: 'email', createdBy: sam.userId, fromAddress: 'sam@gmail.com', status: 'pending' });
    const cards = await t.db.select({ body: messages.body }).from(messages).where(eq(messages.tripId, tripId));
    expect(cards.map((c) => c.body)).toContainEqual(expect.stringMatching(/^Found 2 flights in sam’s email\. Review it in Tickets & files\.$/));

    // Nothing became a booking by itself.
    const bookings = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/bookings`, headers: bearer(owner.accessToken) });
    expect(bookings.json()).toEqual({ bookings: [] });
  });

  it('ignores mail from someone who isn’t an editor on the trip', async () => {
    const { owner, tripId } = await setup();
    await joinTrip(t, tripId, owner.accessToken, 'mom@gmail.com', 'viewer');
    const { outcomes } = run([email({ from: 'stranger@gmail.com' }), email({ from: 'mom@gmail.com' })]);
    expect(await outcomes).toEqual([
      { result: 'ignored', reason: 'not_a_member' },
      { result: 'ignored', reason: 'not_a_member' },
    ]);
    expect(await t.db.select().from(bookingImports)).toHaveLength(0);
  });

  it('ignores mail its sender’s provider didn’t vouch for, or that only claims it did', async () => {
    await setup();
    const failed = `mx.google.com; dkim=fail header.i=@gmail.com; spf=softfail smtp.mailfrom=sam@gmail.com`;
    // A forged "pass" lower down, under the real (failing) one from our server.
    const forged = [`mx.google.com; dkim=none; spf=neutral smtp.mailfrom=evil.example`, GOOD_AUTH('sam@gmail.com')];
    const { box, outcomes } = run([email({ from: 'sam@gmail.com', auth: [failed] }), email({ from: 'sam@gmail.com', auth: forged }), email({ from: 'sam@gmail.com', auth: [] })]);
    expect((await outcomes).map((o) => o.result === 'ignored' && o.reason)).toEqual(['not_verified', 'not_verified', 'not_verified']);
    // Marked read anyway, so they aren't tried again and again.
    expect(box.read).toEqual([1, 2, 3]);
  });

  it('ignores mail to an unknown or old address', async () => {
    await setup();
    const { outcomes } = run([
      email({ from: 'sam@gmail.com', to: 'tagalong.inbox+nosuchtrip@gmail.com' }),
      email({ from: 'sam@gmail.com', to: 'tagalong.inbox@gmail.com' }),
    ]);
    expect((await outcomes).map((o) => o.result === 'ignored' && o.reason)).toEqual(['unknown_trip', 'unknown_trip']);
  });

  it('reads the same email once, however many times it arrives', async () => {
    const { tripId } = await setup();
    const same = email({ from: 'sam@gmail.com', id: 'abc123@mail.gmail.com' });
    expect((await run([same]).outcomes)[0]).toMatchObject({ result: 'added' });
    expect(await run([same]).outcomes).toEqual([{ result: 'ignored', reason: 'duplicate' }]);
    expect(await t.db.select().from(bookingImports).where(eq(bookingImports.tripId, tripId))).toHaveLength(1);
  });

  it('saves an attached ticket PDF to Docs, and reads it when the email says nothing', async () => {
    const { tripId, sam } = await setup();
    const pdf = readFileSync(new URL('./fixtures/booking-emails/air-india-ticket.pdf', import.meta.url));
    const [outcome] = await run([email({ from: 'sam@gmail.com', text: 'Here you go, see attached.', pdf })]).outcomes;
    expect(outcome).toMatchObject({ result: 'added', candidates: 1 });

    const docs = await t.db.select().from(documents).where(eq(documents.tripId, tripId));
    expect(docs).toEqual([expect.objectContaining({ name: 'ticket.pdf', kind: 'ticket', status: 'ready', uploadedBy: sam.userId, contentType: 'application/pdf' })]);
    const [row] = await t.db.select().from(bookingImports).where(eq(bookingImports.tripId, tripId));
    expect(row!.documentId).toBe(docs[0]!.id);
    expect((row!.candidates as { booking: { reference: string } }[])[0]!.booking.reference).toBe('R4TN8Q');
  });
});

describe('who sent it', () => {
  it('trusts only our own server’s verdict, for the sender’s own domain', () => {
    const ok = 'mx.google.com; dkim=pass header.i=@gmail.com header.s=x; spf=pass smtp.mailfrom=sam@gmail.com';
    expect(senderVerified([ok], 'sam@gmail.com', 'mx.google.com')).toBe(true);
    // Signed, but by someone else's domain.
    expect(senderVerified(['mx.google.com; dkim=pass header.d=evil.example; spf=fail'], 'sam@gmail.com', 'mx.google.com')).toBe(false);
    // A subdomain is covered by its parent's signature.
    expect(senderVerified(['mx.google.com; dkim=pass header.d=example.com'], 'sam@mail.example.com', 'mx.google.com')).toBe(true);
    // SPF alone is enough when it's for the From domain.
    expect(senderVerified(['mx.google.com; dkim=none; spf=pass smtp.mailfrom=bounce@example.com'], 'sam@example.com', 'mx.google.com')).toBe(true);
    // A "pass" stamped by some other server proves nothing.
    expect(senderVerified(['evil.example; dkim=pass header.i=@gmail.com'], 'sam@gmail.com', 'mx.google.com')).toBe(false);
  });

  it('finds the trip code in the address it was sent to', () => {
    expect(inboxCodeIn(['Someone <x@y.z>', 'Tagalong.Inbox+K3X9q@gmail.com'], INBOX)).toBe('k3x9q');
    expect(inboxCodeIn(['tagalong.inbox@gmail.com', 'other+abc@gmail.com'], INBOX)).toBeNull();
  });
});
