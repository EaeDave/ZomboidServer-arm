CREATE TABLE "console_log_resyncs" (
	"server_id" uuid NOT NULL,
	"resync_id" text NOT NULL,
	"cursor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "console_log_resyncs" ADD CONSTRAINT "console_log_resyncs_server_id_server_instances_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "console_log_resyncs_server_resync_idx" ON "console_log_resyncs" USING btree ("server_id","resync_id");