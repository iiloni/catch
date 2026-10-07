ALTER TABLE "shared_notes" ADD COLUMN "token" text;
--> statement-breakpoint
UPDATE "shared_notes" SET "token" = "note_shares"."token"
FROM "note_shares" WHERE "shared_notes"."note_id" = "note_shares"."note_id";
--> statement-breakpoint
ALTER TABLE "shared_notes" ALTER COLUMN "token" SET NOT NULL;
