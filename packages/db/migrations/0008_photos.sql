CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "media"."photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"taken_at" timestamp,
	"latitude" double precision,
	"longitude" double precision,
	"status" text DEFAULT 'pending' NOT NULL,
	"caption" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "photos_status_check" CHECK (status in ('pending', 'ready')),
	CONSTRAINT "photos_content_type_check" CHECK (content_type in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "photos_location_check" CHECK ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);
--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_trip_taken_idx" ON "media"."photos" USING btree ("trip_id","taken_at");--> statement-breakpoint
CREATE INDEX "photos_batch_idx" ON "media"."photos" USING btree ("batch_id");