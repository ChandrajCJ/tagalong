CREATE TABLE "expenses"."budget_alerts" (
	"trip_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alerts_trip_id_threshold_pk" PRIMARY KEY("trip_id","threshold")
);
--> statement-breakpoint
CREATE TABLE "expenses"."budgets" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'group' NOT NULL,
	"total_minor" bigint,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_mode_check" CHECK (mode in ('group', 'per_person')),
	CONSTRAINT "budgets_total_check" CHECK (total_minor is null or total_minor > 0)
);
--> statement-breakpoint
ALTER TABLE "expenses"."budget_alerts" ADD CONSTRAINT "budget_alerts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."budgets" ADD CONSTRAINT "budgets_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses"."budgets" ADD CONSTRAINT "budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;