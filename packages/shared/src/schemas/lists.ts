import { z } from 'zod';

export const LIST_KINDS = ['packing', 'todo'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

/** "shared": one tick for the group. "everyone": each person ticks their own. */
export const LIST_ITEM_SCOPES = ['shared', 'everyone'] as const;
export type ListItemScope = (typeof LIST_ITEM_SCOPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** The longest a trip note can be. */
export const NOTE_MAX_CHARS = 20_000;

export const TripList = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string(),
  kind: z.enum(LIST_KINDS),
  position: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type TripList = z.infer<typeof TripList>;

export const ListItem = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  tripId: z.string().uuid(),
  text: z.string(),
  scope: z.enum(LIST_ITEM_SCOPES),
  assigneeId: z.string().uuid().nullable(),
  dueDate: isoDate.nullable(),
  /** The plan item it's about, if any. */
  itemId: z.string().uuid().nullable(),
  /** The shared tick: who ticked it, and when. */
  doneBy: z.string().uuid().nullable(),
  doneAt: z.string().nullable(),
  /** For "everyone" lines: the people still on the trip who've ticked it. */
  checkedBy: z.array(z.string().uuid()),
  position: z.string(),
  createdBy: z.string().uuid(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type ListItem = z.infer<typeof ListItem>;

/** Everything on the trip's checklists, in one answer. */
export const ListsOverview = z.object({
  lists: z.array(TripList),
  items: z.array(ListItem),
});
export type ListsOverview = z.infer<typeof ListsOverview>;

const listTitle = z.string().trim().min(1, 'Give it a name').max(100);

export const CreateListInput = z.object({
  id: z.string().uuid().optional(),
  title: listTitle,
  kind: z.enum(LIST_KINDS),
});
export type CreateListInput = z.input<typeof CreateListInput>;

export const UpdateListInput = z.object({
  title: listTitle.optional(),
  position: z.string().min(1).max(100).optional(),
  version: z.number().int().min(1),
});
export type UpdateListInput = z.input<typeof UpdateListInput>;

const itemFields = {
  text: z.string().trim().min(1, 'Write something').max(200).optional(),
  scope: z.enum(LIST_ITEM_SCOPES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  itemId: z.string().uuid().nullable().optional(),
  position: z.string().min(1).max(100).optional(),
};

/**
 * Add a line to a list. Name the list, or just its kind: then it goes on the
 * trip's first list of that kind, which is made if there isn't one yet.
 */
export const CreateListItemInput = z
  .object({
    ...itemFields,
    id: z.string().uuid().optional(),
    listId: z.string().uuid().optional(),
    kind: z.enum(LIST_KINDS).optional(),
    text: z.string().trim().min(1, 'Write something').max(200),
  })
  .refine((v) => v.listId || v.kind, { message: 'Say which list', path: ['listId'] });
export type CreateListItemInput = z.input<typeof CreateListItemInput>;

export const UpdateListItemInput = z.object({
  ...itemFields,
  version: z.number().int().min(1),
});
export type UpdateListItemInput = z.input<typeof UpdateListItemInput>;

/** What adding a line answers: the line, and the list too when one was made for it. */
export const ListItemCreated = z.object({ item: ListItem, list: TripList.nullable() });
export type ListItemCreated = z.infer<typeof ListItemCreated>;

export const TripNote = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  /** Who saved it last, for "Sam changed this note". */
  updatedBy: z.string().uuid(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type TripNote = z.infer<typeof TripNote>;

export const NoteList = z.object({ notes: z.array(TripNote) });

const noteFields = {
  title: z.string().trim().min(1, 'Give it a title').max(100),
  body: z.string().max(NOTE_MAX_CHARS, 'That’s too long for one note. Split it into two.'),
  pinned: z.boolean(),
};

export const CreateNoteInput = z.object({
  id: z.string().uuid().optional(),
  title: noteFields.title,
  body: noteFields.body.default(''),
  pinned: noteFields.pinned.default(false),
});
export type CreateNoteInput = z.input<typeof CreateNoteInput>;

export const UpdateNoteInput = z.object({
  title: noteFields.title.optional(),
  body: noteFields.body.optional(),
  pinned: noteFields.pinned.optional(),
  version: z.number().int().min(1),
});
export type UpdateNoteInput = z.input<typeof UpdateNoteInput>;

/** A day's own title and note ("Sintra day — 9:10 train from Rossio"). */
export const TripDay = z.object({
  date: isoDate,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type TripDay = z.infer<typeof TripDay>;

/** Leave `version` out only for a day that has no title or note yet. */
export const UpsertDayInput = z.object({
  title: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  version: z.number().int().min(1).optional(),
});
export type UpsertDayInput = z.input<typeof UpsertDayInput>;
