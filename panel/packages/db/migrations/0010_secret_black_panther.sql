CREATE TABLE "console_log_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"agent_cursor" integer NOT NULL,
	"line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_instances" ADD COLUMN "console_log_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "console_log_entries" ADD CONSTRAINT "console_log_entries_server_id_server_instances_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "console_log_entries_server_idx" ON "console_log_entries" USING btree ("server_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "console_log_entries_server_cursor_idx" ON "console_log_entries" USING btree ("server_id","agent_cursor");