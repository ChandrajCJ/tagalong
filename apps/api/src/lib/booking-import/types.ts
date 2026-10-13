import type { BookingDraft, Confidence } from '@tagalong/shared';

/** A booking the parser found, before anyone reviewed it. */
export interface Candidate {
  booking: BookingDraft;
  confidence: Confidence;
  /** Which fields were found, so the review card can say what to check. */
  found: string[];
}

export interface ParseContext {
  /** Where times without a zone are read: the trip's time zone, or UTC. */
  timezone: string;
  /** For dates written without a year: the year the email arrived. */
  year: number;
}
