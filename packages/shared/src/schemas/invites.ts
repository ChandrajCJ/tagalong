import { z } from 'zod';
import { TRIP_ROLES } from '../roles';

/** Invites can make editors or viewers; owners are only made by promoting a member. */
export const INVITE_ROLES = ['editor', 'viewer'] as const;

export const CreateInviteInput = z.object({
  role: z.enum(INVITE_ROLES).default('editor'),
  maxUses: z.number().int().min(1).max(100).optional(),
});
export type CreateInviteInput = z.input<typeof CreateInviteInput>;

export const Invite = z.object({
  id: z.string().uuid(),
  /** Only returned once, when the invite is created. */
  token: z.string().optional(),
  role: z.enum(INVITE_ROLES),
  expiresAt: z.string(),
  maxUses: z.number().int().nullable(),
  useCount: z.number().int(),
  createdByName: z.string(),
});
export type Invite = z.infer<typeof Invite>;

export const InviteList = z.object({ invites: z.array(Invite) });

export const InvitePreview = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
  destination: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  coverColor: z.string(),
  inviterName: z.string(),
  memberCount: z.number().int(),
  role: z.enum(INVITE_ROLES),
  alreadyMember: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const UpdateMemberInput = z.object({
  role: z.enum(TRIP_ROLES),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;
