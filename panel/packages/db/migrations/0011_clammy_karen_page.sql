ALTER TABLE "console_log_entries" ALTER COLUMN "agent_cursor" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "server_instances" ALTER COLUMN "console_log_cursor" SET DATA TYPE bigint;