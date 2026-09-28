CREATE TABLE "board_columns" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "board_columns_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "board_columns" ("id", "user_id", "name", "color", "position")
SELECT defaults.id, users.id, defaults.name, defaults.color, defaults.position
FROM "user" AS users
CROSS JOIN (VALUES
  ('new', 'New', 'amber', 'a0'),
  ('in_progress', 'In progress', 'blue', 'a1'),
  ('hold', 'On hold', 'violet', 'a2')
) AS defaults(id, name, color, position);
