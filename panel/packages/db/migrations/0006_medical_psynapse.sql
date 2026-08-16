CREATE TYPE "public"."operation_event_type" AS ENUM('queued', 'claimed', 'progress', 'log', 'completed', 'recovered');--> statement-breakpoint
CREATE TABLE "operation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"type" "operation_event_type" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "log_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "operations" SET "lease_expires_at" = now() - interval '1 second' WHERE "status" = 'running' AND "lease_expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_server_id_server_instances_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_events" ADD CONSTRAINT "operation_events_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_events_operation_idx" ON "operation_events" USING btree ("operation_id","id");--> statement-breakpoint
CREATE INDEX "operation_events_server_idx" ON "operation_events" USING btree ("server_id","id");