CREATE SCHEMA "itinerary";
--> statement-breakpoint
CREATE TABLE "itinerary"."item_assignees" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "item_assignees_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "itinerary"."items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"date" date,
	"start_time" time,
	"end_time" time,
	"position" text NOT NULL,
	"type" text DEFAULT 'activity' NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"place_name" text,
	"cost_estimate_minor" bigint,
	"cost_currency" char(3),
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "items_type_check" CHECK (type in ('activity', 'meal', 'transport', 'stay', 'flight', 'other'))
);
--> statement-breakpoint
CREATE TABLE "itinerary"."trip_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"date" date NOT NULL,
	"title" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_days_trip_date" UNIQUE("trip_id","date")
);
--> statement-breakpoint
ALTER TABLE "itinerary"."item_assignees" ADD CONSTRAINT "item_assignees_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "itinerary"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."item_assignees" ADD CONSTRAINT "item_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD CONSTRAINT "items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD CONSTRAINT "items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."trip_days" ADD CONSTRAINT "trip_days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_trip_date_position_idx" ON "itinerary"."items" USING btree ("trip_id","date","position");