ALTER TABLE "agents" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_access_token_hash_unique" UNIQUE("access_token_hash");