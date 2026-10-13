CREATE TABLE "itinerary"."booking_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"from_address" text,
	"subject" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" uuid,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_imports_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "booking_imports_source_check" CHECK (source in ('email', 'paste', 'document')),
	CONSTRAINT "booking_imports_status_check" CHECK (status in ('pending', 'added', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "inbox_code" text;--> statement-breakpoint
ALTER TABLE "itinerary"."booking_imports" ADD CONSTRAINT "booking_imports_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."booking_imports" ADD CONSTRAINT "booking_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."booking_imports" ADD CONSTRAINT "booking_imports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_imports_trip_idx" ON "itinerary"."booking_imports" USING btree ("trip_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD CONSTRAINT "trips_inbox_code_unique" UNIQUE("inbox_code");