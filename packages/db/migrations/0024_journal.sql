CREATE SCHEMA "journal";
--> statement-breakpoint
CREATE TABLE "journal"."comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal"."entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"mood" text,
	"visibility" text DEFAULT 'group' NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"place_label" text,
	"latitude" double precision,
	"longitude" double precision,
	"place_ref" text,
	"source_message_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "journal_entries_kind_check" CHECK (kind in ('note', 'quote')),
	CONSTRAINT "journal_entries_visibility_check" CHECK (visibility in ('group', 'private')),
	CONSTRAINT "journal_entries_location_check" CHECK ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180))
);
--> statement-breakpoint
CREATE TABLE "journal"."pushes_sent" (
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pushes_sent_trip_id_user_id_kind_day_pk" PRIMARY KEY("trip_id","user_id","kind","day"),
	CONSTRAINT "journal_pushes_sent_kind_check" CHECK (kind in ('prompt', 'memory', 'recap'))
);
--> statement-breakpoint
CREATE TABLE "journal"."reactions" (
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_entry_id_user_id_emoji_pk" PRIMARY KEY("entry_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "journal"."recaps" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"stamp" text NOT NULL,
	"data" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media"."photos" DROP CONSTRAINT "photos_source_check";--> statement-breakpoint
ALTER TABLE "identity"."notification_prefs" ADD COLUMN "journal" boolean;--> statement-breakpoint
ALTER TABLE "identity"."notification_prefs" ADD COLUMN "memories" boolean;--> statement-breakpoint
ALTER TABLE "identity"."notification_prefs" ADD COLUMN "journal_time" text;--> statement-breakpoint
ALTER TABLE "journal"."comments" ADD CONSTRAINT "comments_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "journal"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."entries" ADD CONSTRAINT "entries_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."entries" ADD CONSTRAINT "entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."entries" ADD CONSTRAINT "entries_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "chat"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."pushes_sent" ADD CONSTRAINT "pushes_sent_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."pushes_sent" ADD CONSTRAINT "pushes_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."reactions" ADD CONSTRAINT "reactions_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "journal"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal"."recaps" ADD CONSTRAINT "recaps_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_comments_entry_idx" ON "journal"."comments" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "journal_entries_trip_date_idx" ON "journal"."entries" USING btree ("trip_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_quote_idx" ON "journal"."entries" USING btree ("source_message_id","author_id") WHERE source_message_id is not null;--> statement-breakpoint
ALTER TABLE "media"."photos" ADD CONSTRAINT "photos_source_check" CHECK (source in ('album', 'chat', 'cover', 'journal'));