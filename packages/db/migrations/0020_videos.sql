ALTER TABLE "media"."photos" DROP CONSTRAINT "photos_content_type_check";--> statement-breakpoint
ALTER TABLE "media"."photos" ADD COLUMN "kind" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "media"."photos" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_kind_check" CHECK (kind in ('photo', 'video'));--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_video_check" CHECK (kind = 'photo' or (duration_ms is not null and duration_ms <= 60000));--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_content_type_check" CHECK (content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'));