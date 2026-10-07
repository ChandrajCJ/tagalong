CREATE TABLE "documents"."bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"item_id" uuid,
	"document_id" uuid,
	"type" text NOT NULL,
	"provider" text,
	"reference" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_minor" bigint,
	"cost_currency" char(3),
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bookings_type_check" CHECK (type in ('flight', 'stay', 'train', 'ticket', 'car', 'restaurant'))
);
--> statement-breakpoint
ALTER TABLE "documents"."bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."bookings" ADD CONSTRAINT "bookings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "itinerary"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."bookings" ADD CONSTRAINT "bookings_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents"."bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_trip_starts_idx" ON "documents"."bookings" USING btree ("trip_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_item_idx" ON "documents"."bookings" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_one_thread_per_item" ON "chat"."channels" USING btree ("item_id") WHERE kind = 'item';