-- One browser can be signed in to several accounts and rings for each (ADR 0019), so an
-- endpoint is no longer one user's alone.
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_pkey";--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_user_id_pk" PRIMARY KEY("endpoint","user_id");
