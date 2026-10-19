ALTER TABLE "chat"."messages" DROP CONSTRAINT "messages_kind_check";--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "read_receipts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "cover_credit" text;--> statement-breakpoint
ALTER TABLE "chat"."read_states" ADD COLUMN "last_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media"."photos" ADD COLUMN "source" text DEFAULT 'album' NOT NULL;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD CONSTRAINT "trips_cover_media_id_photos_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "media"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_kind_check" CHECK (kind in ('text', 'system', 'poll', 'image'));--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_source_check" CHECK (source in ('album', 'chat', 'cover'));--> statement-breakpoint
ALTER TABLE "chat"."read_states" ALTER COLUMN "last_read_at" DROP NOT NULL;