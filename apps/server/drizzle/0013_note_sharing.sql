CREATE TABLE "note_shares" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shared_notes" (
	"user_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"owner_name" text NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"color" text DEFAULT 'default' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shared_notes_user_id_note_id_pk" PRIMARY KEY("user_id","note_id")
);
--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_notes" ADD CONSTRAINT "shared_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_notes" ADD CONSTRAINT "shared_notes_note_id_note_shares_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note_shares"("note_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_notes" ADD CONSTRAINT "shared_notes_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_shares_user_id_index" ON "note_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shared_notes_note_id_index" ON "shared_notes" USING btree ("note_id");