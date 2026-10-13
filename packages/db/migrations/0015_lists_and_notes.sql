CREATE SCHEMA "lists";
--> statement-breakpoint
CREATE TABLE "lists"."list_item_checks" (
	"list_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_item_checks_list_item_id_user_id_pk" PRIMARY KEY("list_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lists"."list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"text" text NOT NULL,
	"scope" text DEFAULT 'shared' NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"item_id" uuid,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"position" text NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "list_items_scope_check" CHECK (scope in ('shared', 'everyone'))
);
--> statement-breakpoint
CREATE TABLE "lists"."lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"position" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lists_kind_check" CHECK (kind in ('packing', 'todo'))
);
--> statement-breakpoint
CREATE TABLE "lists"."notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notes_body_length_check" CHECK (char_length(body) <= 20000)
);
--> statement-breakpoint
ALTER TABLE "lists"."list_item_checks" ADD CONSTRAINT "list_item_checks_list_item_id_list_items_id_fk" FOREIGN KEY ("list_item_id") REFERENCES "lists"."list_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_item_checks" ADD CONSTRAINT "list_item_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "lists"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "itinerary"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."list_items" ADD CONSTRAINT "list_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."lists" ADD CONSTRAINT "lists_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."notes" ADD CONSTRAINT "notes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists"."notes" ADD CONSTRAINT "notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_items_trip_idx" ON "lists"."list_items" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "list_items_list_idx" ON "lists"."list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "list_items_item_idx" ON "lists"."list_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "lists_trip_idx" ON "lists"."lists" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "notes_trip_idx" ON "lists"."notes" USING btree ("trip_id");