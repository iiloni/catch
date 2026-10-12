CREATE TABLE "history_origins" (
	"user_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"origin_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_operation_id" uuid NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "history_origins_user_id_note_id_origin_id_kind_pk" PRIMARY KEY("user_id","note_id","origin_id","kind")
);
--> statement-breakpoint
CREATE TABLE "history_payloads" (
	"user_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"key" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "history_payloads_user_id_note_id_epoch_key_pk" PRIMARY KEY("user_id","note_id","epoch","key")
);
--> statement-breakpoint
CREATE TABLE "history_restores" (
	"user_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"result_token" uuid NOT NULL,
	CONSTRAINT "history_restores_user_id_note_id_operation_id_pk" PRIMARY KEY("user_id","note_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "history_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"epoch" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"representation" text NOT NULL,
	"parent_id" uuid,
	"depth" integer NOT NULL,
	"content_key" text NOT NULL,
	"payload_key" text NOT NULL,
	"source_key" text,
	"format" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"epoch" uuid NOT NULL,
	"content_token" uuid NOT NULL,
	"latest_capture_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"next_sequence" integer DEFAULT 0 NOT NULL,
	"first_sequence" integer DEFAULT 1 NOT NULL,
	"last_origin_id" uuid,
	"last_content_key" text,
	"last_checkpoint_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "note_history_user_id_id_index" ON "note_history" USING btree ("user_id","id");
--> statement-breakpoint
ALTER TABLE "history_origins" ADD CONSTRAINT "history_origins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_origins" ADD CONSTRAINT "history_origins_user_id_note_id_note_history_user_id_id_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."note_history"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_payloads" ADD CONSTRAINT "history_payloads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_payloads" ADD CONSTRAINT "history_payloads_user_id_note_id_note_history_user_id_id_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."note_history"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_restores" ADD CONSTRAINT "history_restores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_restores" ADD CONSTRAINT "history_restores_user_id_note_id_note_history_user_id_id_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."note_history"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_versions" ADD CONSTRAINT "history_versions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_versions" ADD CONSTRAINT "history_versions_user_id_note_id_note_history_user_id_id_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."note_history"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_history" ADD CONSTRAINT "note_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "history_versions_user_id_note_id_epoch_sequence_index" ON "history_versions" USING btree ("user_id","note_id","epoch","sequence");--> statement-breakpoint
CREATE INDEX "note_history_user_id_index" ON "note_history" USING btree ("user_id");--> statement-breakpoint
--> statement-breakpoint
INSERT INTO "note_history" ("id", "user_id", "kind", "epoch", "content_token")
SELECT "id", "user_id", 'note', "id", "id" FROM "notes"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "note_history" ("id", "user_id", "kind", "epoch", "content_token")
SELECT "id", "user_id", 'vault', "id", "id" FROM "vault_notes"
ON CONFLICT DO NOTHING;
