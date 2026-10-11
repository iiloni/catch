CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "ai_configuration" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"embedding" jsonb NOT NULL,
	"api_key" text,
	"dimensions" integer,
	"generation" uuid NOT NULL,
	"revision" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_jobs" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"generation" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease" uuid,
	"leased_until" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "note_embeddings" (
	"note_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"chunk" integer NOT NULL,
	"generation" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector NOT NULL,
	CONSTRAINT "note_embeddings_note_id_chunk_pk" PRIMARY KEY("note_id","chunk")
);
--> statement-breakpoint
ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_jobs_available_at_index" ON "embedding_jobs" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "embedding_jobs_user_id_index" ON "embedding_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "note_embeddings_user_id_index" ON "note_embeddings" USING btree ("user_id");
--> statement-breakpoint
CREATE FUNCTION public.queue_note_embedding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_generation uuid;
BEGIN
  IF current_setting('catch.restoring', true) = 'true' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.search_text IS NOT DISTINCT FROM OLD.search_text
    AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
  DELETE FROM public.note_embeddings WHERE note_id = NEW.id;
  DELETE FROM public.embedding_jobs WHERE note_id = NEW.id;
  SELECT generation INTO active_generation FROM public.ai_configuration WHERE id = 'default' AND enabled;
  IF active_generation IS NOT NULL AND NEW.deleted_at IS NULL AND btrim(NEW.search_text) <> '' THEN
    INSERT INTO public.embedding_jobs (note_id, user_id, generation, content_hash, available_at)
    VALUES (NEW.id, NEW.user_id, active_generation, md5(NEW.search_text), now() + interval '5 seconds')
    ON CONFLICT (note_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notes_embedding_changed AFTER INSERT OR UPDATE OF search_text, deleted_at ON public.notes
FOR EACH ROW EXECUTE FUNCTION public.queue_note_embedding();
