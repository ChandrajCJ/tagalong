CREATE TABLE "itinerary"."idea_votes" (
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_votes_idea_id_user_id_pk" PRIMARY KEY("idea_id","user_id"),
	CONSTRAINT "idea_votes_value_check" CHECK (value in ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "itinerary"."ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"url" text,
	"type" text DEFAULT 'activity' NOT NULL,
	"created_by" uuid NOT NULL,
	"promoted_item_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ideas_type_check" CHECK (type in ('activity', 'meal', 'transport', 'stay', 'flight', 'other'))
);
--> statement-breakpoint
CREATE TABLE "chat"."poll_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"poll_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat"."poll_votes" (
	"option_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."polls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"question" text NOT NULL,
	"multi" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP CONSTRAINT "messages_kind_check";--> statement-breakpoint
ALTER TABLE "itinerary"."idea_votes" ADD CONSTRAINT "idea_votes_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "itinerary"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."idea_votes" ADD CONSTRAINT "idea_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD CONSTRAINT "ideas_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary"."ideas" ADD CONSTRAINT "ideas_promoted_item_id_items_id_fk" FOREIGN KEY ("promoted_item_id") REFERENCES "itinerary"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_options" ADD CONSTRAINT "poll_options_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "chat"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "chat"."poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "chat"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."polls" ADD CONSTRAINT "polls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."polls" ADD CONSTRAINT "polls_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."polls" ADD CONSTRAINT "polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_trip_idx" ON "itinerary"."ideas" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "poll_options_poll_idx" ON "chat"."poll_options" USING btree ("poll_id","position");--> statement-breakpoint
CREATE INDEX "poll_votes_poll_idx" ON "chat"."poll_votes" USING btree ("poll_id","user_id");--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_kind_check" CHECK (kind in ('text', 'system', 'poll'));