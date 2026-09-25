CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "trips";
--> statement-breakpoint
CREATE SCHEMA "sync";
--> statement-breakpoint
CREATE TABLE "identity"."auth_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_uid" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "auth_identities_provider_check" CHECK (provider in ('email', 'apple', 'google'))
);
--> statement-breakpoint
CREATE TABLE "identity"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"platform" text,
	"push_token" text,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."login_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_key" text,
	"home_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"locale" text,
	"timezone" text,
	"face_grouping_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trips"."invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"invited_email" text,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_role_check" CHECK (role in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "trips"."trip_members" (
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "trip_members_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id"),
	CONSTRAINT "trip_members_role_check" CHECK (role in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "trips"."trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"destination" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"timezone" text,
	"base_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"cover_color" text DEFAULT '#D8A47F' NOT NULL,
	"created_by" uuid NOT NULL,
	"public_slug" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "trips_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
CREATE TABLE "sync"."change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_log_op_check" CHECK (op in ('upsert', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "identity"."auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "identity"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."invites" ADD CONSTRAINT "invites_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."trip_members" ADD CONSTRAINT "trip_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips"."trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "identity"."devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "identity"."login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "identity"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "identity"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "invites_trip_idx" ON "trips"."invites" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_members_user_idx" ON "trips"."trip_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "change_log_trip_seq_idx" ON "sync"."change_log" USING btree ("trip_id","seq");