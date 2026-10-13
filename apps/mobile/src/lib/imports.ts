import { BookingImport, ImportAdded, ImportList, newId, TripInbox, type BookingCandidate } from '@tagalong/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from './api';
import { useTripRealtime } from './realtime';
import type { BookingFields } from '@/components/booking-sheet';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** "Best guess" wording for how sure the reader is. */
export const confidenceNote = (c: BookingCandidate) =>
  c.confidence === 'high'
    ? 'Read from the booking details built into the email.'
    : c.confidence === 'medium'
      ? 'Read from the email’s text. Check the times before adding.'
      : 'A rough guess from the email’s text. Check everything before adding.';

/** Bookings found in emails, pastes and files for this trip, kept live. Editors only. */
export function useImports(tripId: string | undefined, enabled: boolean) {
  const [imports, setImports] = useState<BookingImport[] | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!tripId || !enabled) return;
    try {
      setImports((await request(`/trips/${tripId}/imports`, { schema: ImportList })).imports);
      setError(undefined);
    } catch (e) {
      setError(message(e, 'Could not load what was found in emails'));
    }
  }, [tripId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = useCallback(
    (found: BookingImport) => setImports((prev) => [found, ...(prev ?? []).filter((i) => i.id !== found.id)]),
    [],
  );

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind !== 'event' || (m.event.type !== 'import.created' && m.event.type !== 'import.updated')) return;
    const parsed = BookingImport.safeParse(m.event.payload);
    if (parsed.success) upsert(parsed.data);
  });

  const pending = (imports ?? []).filter((i) => i.status === 'pending');
  const openCount = pending.reduce((n, i) => n + i.candidates.filter((c) => c.state === 'open').length, 0);

  /** Reads pasted text, or a file in Docs. Returns the import, or an error to show. */
  const read = async (input: { text: string } | { documentId: string }): Promise<BookingImport | string> => {
    if (!tripId) return 'Trip not loaded';
    try {
      const found = await request(`/trips/${tripId}/imports`, { method: 'POST', body: { id: newId(), ...input }, schema: BookingImport });
      upsert(found);
      return found;
    } catch (e) {
      return message(e, 'Could not read that');
    }
  };

  /** Adds one candidate as a booking (and, by default, a plan item). */
  const add = async (
    found: BookingImport,
    index: number,
    fields: BookingFields,
    addToPlan: boolean,
  ): Promise<{ itemId: string | null } | { error: string }> => {
    try {
      const res = await request(`/imports/${found.id}/add`, {
        method: 'POST',
        body: { candidateIndex: index, booking: { ...fields, id: newId() }, addToPlan },
        schema: ImportAdded,
      });
      upsert(res.import);
      return { itemId: res.itemId };
    } catch (e) {
      const current = e instanceof ApiError && e.status === 409 && BookingImport.safeParse(e.data.current);
      if (current && current.success) upsert(current.data);
      return { error: message(e, 'Could not add that booking') };
    }
  };

  /** "Not this", for one candidate or the whole import. */
  const dismiss = async (found: BookingImport, index?: number): Promise<string | null> => {
    try {
      upsert(await request(`/imports/${found.id}/dismiss`, { method: 'POST', body: index === undefined ? {} : { candidateIndex: index }, schema: BookingImport }));
      return null;
    } catch (e) {
      return message(e, 'Could not do that');
    }
  };

  return { imports, pending, openCount, error, load, read, add, dismiss };
}

/** The trip's forwarding address, or null when this server can't receive email. */
export function useInbox(tripId: string | undefined, enabled: boolean) {
  const [address, setAddress] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tripId || !enabled) return;
    request(`/trips/${tripId}/inbox`, { schema: TripInbox })
      .then((r) => setAddress(r.address))
      .catch(() => setAddress(null));
  }, [tripId, enabled]);

  const rotate = async (): Promise<string | null> => {
    if (!tripId) return 'Trip not loaded';
    try {
      setAddress((await request(`/trips/${tripId}/inbox/rotate`, { method: 'POST', schema: TripInbox })).address);
      return null;
    } catch (e) {
      return message(e, 'Could not change the address');
    }
  };
  return { address, rotate };
}
