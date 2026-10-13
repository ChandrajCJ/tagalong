import {
  ListItem,
  ListItemCreated,
  ListsOverview,
  NoteList,
  newId,
  positionBetween,
  TripList,
  TripNote,
  type ListItemScope,
  type ListKind,
  type Trip,
} from '@tagalong/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from './api';
import { useTripRealtime } from './realtime';

export const KIND_LABEL: Record<ListKind, string> = { packing: 'Packing', todo: 'To-dos' };

/** Plain byte order, matching how the server sorts positions. */
const byPosition = (a: { position: string; id: string }, b: { position: string; id: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1;

/** Applies a newer copy; ignores anything older than what we already have. Ticks keep the version, so equal wins. */
const upsertBy = <T extends { id: string; version: number }>(prev: T[], next: T) => {
  const i = prev.findIndex((p) => p.id === next.id);
  if (i === -1) return [...prev, next];
  if (prev[i]!.version > next.version) return prev;
  const copy = [...prev];
  copy[i] = next;
  return copy;
};

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/**
 * The trip's checklists, kept live: loads them, follows other people's
 * changes, and saves yours straight away on screen before the server answers.
 * Every mutation returns an error to show, or null.
 */
export function useTripLists(trip: Trip | undefined) {
  const [lists, setLists] = useState<TripList[] | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [error, setError] = useState<string>();
  const tripId = trip?.id;

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const data = await request(`/trips/${tripId}/lists`, { schema: ListsOverview });
      setLists(data.lists);
      setItems(data.items);
      setError(undefined);
    } catch (e) {
      setError(message(e, 'Could not load the lists'));
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertItem = useCallback((item: ListItem) => setItems((prev) => upsertBy(prev, item)), []);
  const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const upsertList = useCallback((list: TripList) => setLists((prev) => upsertBy(prev ?? [], list)), []);
  const removeList = useCallback((id: string) => {
    setLists((prev) => prev?.filter((l) => l.id !== id) ?? prev);
    setItems((prev) => prev.filter((i) => i.listId !== id));
  }, []);

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind !== 'event') return;
    const { event } = m;
    if (event.type === 'list_item.upserted') {
      const parsed = ListItem.safeParse(event.payload);
      if (parsed.success) upsertItem(parsed.data);
    } else if (event.type === 'list_item.deleted') {
      removeItem(event.entityId);
    } else if (event.type === 'list.upserted') {
      const parsed = TripList.safeParse(event.payload);
      if (parsed.success) upsertList(parsed.data);
    } else if (event.type === 'list.deleted') {
      removeList(event.entityId);
    } else if (event.type === 'member.left') {
      // Their ticks stop counting.
      void load();
    }
  });

  const sortedLists = (lists ?? []).slice().sort(byPosition);
  const sortedItems = items.slice().sort(byPosition);

  /** Adds a line to `listId`, or to the first list of `kind` (made by the server if there's none). */
  const add = async (fields: {
    kind: ListKind;
    listId?: string;
    text: string;
    scope?: ListItemScope;
    itemId?: string | null;
  }): Promise<string | null> => {
    if (!trip) return 'Trip not loaded';
    const id = newId();
    const target = fields.listId ?? sortedLists.find((l) => l.kind === fields.kind)?.id;
    // No list of that kind yet: show a stand-in until the server makes the real one.
    const standIn: TripList | null = target
      ? null
      : {
          id: newId(),
          tripId: trip.id,
          title: KIND_LABEL[fields.kind],
          kind: fields.kind,
          position: positionBetween(sortedLists.at(-1)?.position ?? null, null),
          version: 0,
          updatedAt: new Date().toISOString(),
        };
    if (standIn) upsertList(standIn);
    const listId = target ?? standIn!.id;
    const last = sortedItems.filter((i) => i.listId === listId).at(-1);
    const optimistic: ListItem = {
      id,
      listId,
      tripId: trip.id,
      text: fields.text,
      scope: fields.scope ?? 'shared',
      assigneeId: null,
      dueDate: null,
      itemId: fields.itemId ?? null,
      doneBy: null,
      doneAt: null,
      checkedBy: [],
      position: positionBetween(last?.position ?? null, null),
      createdBy: trip.myUserId,
      version: 0,
      updatedAt: new Date().toISOString(),
    };
    upsertItem(optimistic);
    try {
      const res = await request(`/trips/${trip.id}/list-items`, {
        method: 'POST',
        body: {
          id,
          text: fields.text,
          scope: optimistic.scope,
          itemId: fields.itemId ?? undefined,
          ...(target ? { listId: target } : { kind: fields.kind }),
        },
        schema: ListItemCreated,
      });
      if (standIn) removeList(standIn.id);
      if (res.list) upsertList(res.list);
      upsertItem(res.item);
      // Someone else made the list a moment ago: fetch it.
      if (standIn && !res.list) void load();
      return null;
    } catch (e) {
      removeItem(id);
      if (standIn) removeList(standIn.id);
      return message(e, 'Could not add that');
    }
  };

  /** Adds several lines in order (the starter packing list), all on one list. */
  const addMany = async (kind: ListKind, entries: { text: string; scope: ListItemScope }[]): Promise<string | null> => {
    if (!trip) return 'Trip not loaded';
    let listId = sortedLists.find((l) => l.kind === kind)?.id;
    try {
      for (const entry of entries) {
        const res = await request(`/trips/${trip.id}/list-items`, {
          method: 'POST',
          body: { id: newId(), ...entry, ...(listId ? { listId } : { kind }) },
          schema: ListItemCreated,
        });
        if (res.list) upsertList(res.list);
        upsertItem(res.item);
        listId = res.item.listId;
      }
      return null;
    } catch (e) {
      void load();
      return message(e, 'Could not add everything');
    }
  };

  /** Ticks or unticks: the group's tick on a shared line (editors), your own on an "everyone" line (anyone). */
  const toggle = async (item: ListItem, canEdit: boolean): Promise<string | null> => {
    if (!trip) return 'Trip not loaded';
    const me = trip.myUserId;
    if (item.scope === 'shared') {
      if (!canEdit) return 'Only editors can tick this off for the group.';
      const done = item.doneAt === null;
      upsertItem({ ...item, doneAt: done ? new Date().toISOString() : null, doneBy: done ? me : null });
      try {
        upsertItem(await request(`/list-items/${item.id}/done`, { method: done ? 'POST' : 'DELETE', schema: ListItem }));
        return null;
      } catch (e) {
        upsertItem(item);
        return message(e, 'Could not save that tick');
      }
    }
    const checked = !item.checkedBy.includes(me);
    upsertItem({ ...item, checkedBy: checked ? [...item.checkedBy, me] : item.checkedBy.filter((u) => u !== me) });
    try {
      upsertItem(await request(`/list-items/${item.id}/check`, { method: checked ? 'POST' : 'DELETE', schema: ListItem }));
      return null;
    } catch (e) {
      upsertItem(item);
      return message(e, 'Could not save that tick');
    }
  };

  /** Edits a line. On a conflict, shows their copy and says so. */
  const update = async (
    item: ListItem,
    changes: Partial<Pick<ListItem, 'text' | 'scope' | 'assigneeId' | 'dueDate' | 'itemId'>>,
  ): Promise<string | null> => {
    upsertItem({ ...item, ...changes });
    try {
      upsertItem(
        await request(`/list-items/${item.id}`, {
          method: 'PATCH',
          body: { ...changes, version: item.version },
          schema: ListItem,
        }),
      );
      return null;
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && ListItem.safeParse(e.data.current);
      if (latest && latest.success) {
        upsertItem(latest.data);
        return 'Someone changed this first. Showing their version.';
      }
      upsertItem(item);
      return message(e, 'Could not save that');
    }
  };

  const remove = async (item: ListItem): Promise<string | null> => {
    removeItem(item.id);
    try {
      await request(`/list-items/${item.id}`, { method: 'DELETE' });
      return null;
    } catch (e) {
      void load();
      return message(e, 'Could not remove that');
    }
  };

  const createList = async (kind: ListKind, title: string): Promise<string | null> => {
    if (!trip) return 'Trip not loaded';
    const id = newId();
    upsertList({
      id,
      tripId: trip.id,
      title,
      kind,
      position: positionBetween(sortedLists.at(-1)?.position ?? null, null),
      version: 0,
      updatedAt: new Date().toISOString(),
    });
    try {
      upsertList(await request(`/trips/${trip.id}/lists`, { method: 'POST', body: { id, title, kind }, schema: TripList }));
      return null;
    } catch (e) {
      removeList(id);
      return message(e, 'Could not make that list');
    }
  };

  const renameList = async (list: TripList, title: string): Promise<string | null> => {
    try {
      upsertList(await request(`/lists/${list.id}`, { method: 'PATCH', body: { title, version: list.version }, schema: TripList }));
      return null;
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && TripList.safeParse(e.data.current);
      if (latest && latest.success) upsertList(latest.data);
      return message(e, 'Could not rename that list');
    }
  };

  const deleteList = async (list: TripList): Promise<string | null> => {
    removeList(list.id);
    try {
      await request(`/lists/${list.id}`, { method: 'DELETE' });
      return null;
    } catch (e) {
      void load();
      return message(e, 'Could not delete that list');
    }
  };

  return {
    lists: lists ? sortedLists : null,
    items: sortedItems,
    error,
    load,
    add,
    addMany,
    toggle,
    update,
    remove,
    createList,
    renameList,
    deleteList,
  };
}

/** The trip's notes, pinned first and then newest, kept live. */
export function useTripNotes(tripId: string | undefined) {
  const [notes, setNotes] = useState<TripNote[] | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setNotes((await request(`/trips/${tripId}/notes`, { schema: NoteList })).notes);
      setError(undefined);
    } catch (e) {
      setError(message(e, 'Could not load the notes'));
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind !== 'event') return;
    if (m.event.type === 'note.upserted') {
      const parsed = TripNote.safeParse(m.event.payload);
      if (parsed.success) setNotes((prev) => upsertBy(prev ?? [], parsed.data));
    } else if (m.event.type === 'note.deleted') {
      const id = m.event.entityId;
      setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    }
  });

  const upsert = useCallback((note: TripNote) => setNotes((prev) => upsertBy(prev ?? [], note)), []);
  const drop = useCallback((id: string) => setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev), []);

  const sorted = notes
    ?.slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  return { notes: sorted ?? null, error, load, upsert, drop };
}

/** What saving a note comes back with: the saved note, the other person's copy, or an error to show. */
export type NoteSave = { saved: TripNote } | { conflict: TripNote } | { error: string };

/** Makes a note. Retrying with the same id gives back the same note. */
export const createNote = async (
  tripId: string,
  fields: { title: string; body?: string; pinned?: boolean },
): Promise<NoteSave> => {
  try {
    const saved = await request(`/trips/${tripId}/notes`, {
      method: 'POST',
      body: { id: newId(), ...fields },
      schema: TripNote,
    });
    return { saved };
  } catch (e) {
    return { error: message(e, 'Could not make that note') };
  }
};

/**
 * Saves changes on top of `base`, the copy you started editing from. If
 * someone saved in between, you get their copy back to choose from.
 */
export const saveNote = async (
  base: TripNote,
  changes: Partial<Pick<TripNote, 'title' | 'body' | 'pinned'>>,
): Promise<NoteSave> => {
  try {
    const saved = await request(`/notes/${base.id}`, {
      method: 'PATCH',
      body: { ...changes, version: base.version },
      schema: TripNote,
    });
    return { saved };
  } catch (e) {
    const latest = e instanceof ApiError && e.status === 409 && TripNote.safeParse(e.data.current);
    if (latest && latest.success) return { conflict: latest.data };
    return { error: message(e, 'Could not save the note') };
  }
};

export const deleteNote = async (noteId: string): Promise<string | null> => {
  try {
    await request(`/notes/${noteId}`, { method: 'DELETE' });
    return null;
  } catch (e) {
    return message(e, 'Could not delete the note');
  }
};

/** "Sam", "you", or "someone" (for a person who has left the trip). */
export const personName = (trip: Pick<Trip, 'members' | 'myUserId'>, userId: string | null) => {
  if (!userId) return null;
  if (userId === trip.myUserId) return 'you';
  return trip.members.find((m) => m.userId === userId)?.displayName ?? 'someone';
};
