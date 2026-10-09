CREATE TABLE "media"."photo_favourites" (
	"photo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_favourites_photo_id_user_id_pk" PRIMARY KEY("photo_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "media"."photo_favourites" ADD CONSTRAINT "photo_favourites_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "media"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media"."photo_favourites" ADD CONSTRAINT "photo_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;