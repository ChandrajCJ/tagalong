ALTER TABLE "trips"."trips" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "bounds" jsonb;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD COLUMN "country_code" char(2);--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD COLUMN "place_ref" text;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD COLUMN "place_ref" text;