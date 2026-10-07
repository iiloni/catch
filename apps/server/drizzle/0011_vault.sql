CREATE TABLE "vault_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"user_id" text PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"iterations" integer NOT NULL,
	"password_key" text NOT NULL,
	"recovery_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vault_notes" ADD CONSTRAINT "vault_notes_user_id_vaults_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."vaults"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_notes_user_id_index" ON "vault_notes" USING btree ("user_id");