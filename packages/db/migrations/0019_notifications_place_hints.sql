CREATE TABLE "identity"."notification_prefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid,
	"chat" boolean,
	"mentions" boolean,
	"plan" boolean,
	"money" boolean,
	"todos" boolean,
	"trip" boolean,
	"reminders" boolean,
	"reminder_minutes" integer,
	"muted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itinerary"."items" ADD COLUMN "place_hint_dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."notification_prefs" ADD CONSTRAINT "notification_prefs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user_trip_idx" ON "identity"."notification_prefs" USING btree ("user_id",coalesce("trip_id", '00000000-0000-0000-0000-000000000000'::uuid));