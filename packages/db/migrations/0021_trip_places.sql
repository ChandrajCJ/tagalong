CREATE TABLE "trips"."trip_places" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"position" text NOT NULL,
	"destination" text NOT NULL,
	"place_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"bounds" jsonb,
	"country_code" char(2),
	"timezone" text,
	"start_date" date,
	"end_date" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips"."trip_places" ADD CONSTRAINT "trip_places_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_places_trip_position_idx" ON "trips"."trip_places" USING btree ("trip_id","position");--> statement-breakpoint
-- Every existing trip gets one place, copied from its destination ("a0" is the first fractional-index key).
INSERT INTO "trips"."trip_places" ("id", "trip_id", "position", "destination", "place_id", "latitude", "longitude", "bounds", "country_code", "timezone")
SELECT gen_random_uuid(), "id", 'a0', "destination", "place_id", "latitude", "longitude", "bounds", "country_code", "timezone" FROM "trips"."trips";
