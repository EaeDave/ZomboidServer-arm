ALTER TABLE "operations" ADD COLUMN "target_state" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "progress_message" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "progress_updated_at" timestamp with time zone;