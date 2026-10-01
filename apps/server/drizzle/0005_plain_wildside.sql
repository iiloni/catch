ALTER TABLE "user" ADD COLUMN "last_login_at" timestamp with time zone;
--> statement-breakpoint
-- Recover known logins from existing sessions; accounts without history stay unknown.
UPDATE "user" AS u
SET "last_login_at" = logins."last_login_at"
FROM (
  SELECT "user_id", max("created_at") AS "last_login_at"
  FROM "session"
  GROUP BY "user_id"
) AS logins
WHERE u."id" = logins."user_id";
