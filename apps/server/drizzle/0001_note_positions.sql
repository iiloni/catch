ALTER TABLE "notes" ADD COLUMN "position" text;--> statement-breakpoint
-- Keep existing notes in the order the gallery showed them (last edited first). Each gets
-- a fractional index "d" + four base-62 digits, which sorts like the keys clients generate.
WITH "ranked" AS (
	SELECT "id", row_number() OVER (PARTITION BY "user_id" ORDER BY "updated_at" DESC, "id" DESC) - 1 AS "n"
	FROM "notes"
)
UPDATE "notes" SET "position" = 'd' || (
	SELECT string_agg(substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', ("ranked"."n" / (62 ^ "p")::bigint % 62)::int + 1, 1), '' ORDER BY "p" DESC)
	FROM generate_series(0, 3) AS "p"
)
FROM "ranked" WHERE "notes"."id" = "ranked"."id";--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "position" SET NOT NULL;
