CREATE TABLE "link_preview_assets" (
	"hash" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_previews" (
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"image_hash" text,
	"image_width" integer,
	"image_height" integer,
	"icon_hash" text,
	"hue" integer,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_previews_user_id_url_pk" PRIMARY KEY("user_id","url")
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "hidden_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "link_previews" ADD CONSTRAINT "link_previews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;