import { z } from 'zod';
import { ItineraryItem, ITEM_TYPES } from './itinerary';

/** How someone feels about an idea. Clearing a vote deletes the row instead. */
export const VOTE_VALUES = ['up', 'down'] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

export const IdeaVoter = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  value: z.enum(VOTE_VALUES),
});
export type IdeaVoter = z.infer<typeof IdeaVoter>;

export const Idea = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string(),
  note: z.string().nullable(),
  url: z.string().nullable(),
  type: z.enum(ITEM_TYPES),
  createdBy: z.string().uuid(),
  /** Set once this idea became a plan item. */
  promotedItemId: z.string().uuid().nullable(),
  version: z.number().int(),
  updatedAt: z.string(),
  ups: z.number().int(),
  downs: z.number().int(),
  /** Everyone who voted, so the board can show faces. */
  voters: z.array(IdeaVoter),
  /** This user's own vote, if any. */
  myVote: z.enum(VOTE_VALUES).nullable(),
});
export type Idea = z.infer<typeof Idea>;

export const IdeaList = z.object({ ideas: z.array(Idea) });

const editableFields = {
  title: z.string().trim().min(1, 'Give it a name').max(200).optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  url: z.string().trim().url('That doesn’t look like a link').max(2000).nullable().optional(),
  type: z.enum(ITEM_TYPES).optional(),
};

export const CreateIdeaInput = z.object({
  ...editableFields,
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Give it a name').max(200),
  type: z.enum(ITEM_TYPES).default('activity'),
});
export type CreateIdeaInput = z.input<typeof CreateIdeaInput>;

/** `version` is the one you last saw; a mismatch means someone changed it since. */
export const UpdateIdeaInput = z.object({
  ...editableFields,
  version: z.number().int().min(1),
});
export type UpdateIdeaInput = z.input<typeof UpdateIdeaInput>;

export const VoteIdeaInput = z.object({ value: z.enum(VOTE_VALUES) });

/** Promoting puts the idea on a day in the plan; null means "Anytime". */
export const PromoteIdeaInput = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable()
    .default(null),
});
export type PromoteIdeaInput = z.input<typeof PromoteIdeaInput>;

/** What promoting returns: the idea, now marked, and the plan item it became. */
export const PromoteResult = z.object({ idea: Idea, item: ItineraryItem });
export type PromoteResult = z.infer<typeof PromoteResult>;
