ALTER TABLE "trips"."invites" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "trips"."invites" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trips"."invites" ADD COLUMN "revoked_at" timestamp with time zone;