CREATE SCHEMA "documents";
--> statement-breakpoint
CREATE TABLE "documents"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"status" text DEFAULT 'pending' NOT NULL,
	"thumbnail_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_kind_check" CHECK (kind in ('flight', 'stay', 'ticket', 'other')),
	CONSTRAINT "documents_status_check" CHECK (status in ('pending', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "documents"."documents" ADD CONSTRAINT "documents_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_trip_idx" ON "documents"."documents" USING btree ("trip_id","created_at" DESC NULLS LAST);