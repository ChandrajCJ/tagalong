CREATE SCHEMA "expenses";
--> statement-breakpoint
CREATE TABLE "expenses"."expense_splits" (
	"expense_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	"share_minor" bigint NOT NULL,
	CONSTRAINT "expense_splits_expense_id_user_id_pk" PRIMARY KEY("expense_id","user_id"),
	CONSTRAINT "expense_splits_share_check" CHECK (share_minor >= 0 and value >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses"."expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"paid_by" uuid NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"base_amount_minor" bigint NOT NULL,
	"spent_on" date NOT NULL,
	"split_method" text NOT NULL,
	"item_id" uuid,
	"booking_id" uuid,
	"source_message_id" uuid,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_amount_check" CHECK (amount_minor > 0 and base_amount_minor >= 0),
	CONSTRAINT "expenses_rate_check" CHECK (fx_rate > 0),
	CONSTRAINT "expenses_category_check" CHECK (category in ('food', 'transport', 'stay', 'activity', 'shopping', 'other')),
	CONSTRAINT "expenses_split_method_check" CHECK (split_method in ('equal', 'exact', 'percent', 'shares'))
);
--> statement-breakpoint
CREATE TABLE "expenses"."settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_user" uuid NOT NULL,
	"to_user" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"note" text,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "settlements_amount_check" CHECK (amount_minor > 0),
	CONSTRAINT "settlements_people_check" CHECK (from_user <> to_user),
	CONSTRAINT "settlements_method_check" CHECK (method in ('cash', 'transfer', 'other'))
);
--> statement-breakpoint
ALTER TABLE "expenses"."expense_splits" ADD CONSTRAINT "expense_splits_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "expenses"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expense_splits" ADD CONSTRAINT "expense_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "itinerary"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "documents"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "chat"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."settlements" ADD CONSTRAINT "settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."settlements" ADD CONSTRAINT "settlements_from_user_users_id_fk" FOREIGN KEY ("from_user") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."settlements" ADD CONSTRAINT "settlements_to_user_users_id_fk" FOREIGN KEY ("to_user") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_splits_user_idx" ON "expenses"."expense_splits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "expenses_trip_spent_idx" ON "expenses"."expenses" USING btree ("trip_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_booking_idx" ON "expenses"."expenses" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "settlements_trip_idx" ON "expenses"."settlements" USING btree ("trip_id","settled_at");