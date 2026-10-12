ALTER TABLE "history_versions" ADD COLUMN "reading_key" text;--> statement-breakpoint
ALTER TABLE "note_history" ADD COLUMN "last_reading_key" text;