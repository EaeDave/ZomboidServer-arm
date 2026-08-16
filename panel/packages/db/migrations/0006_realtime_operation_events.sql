ALTER TABLE "operations" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE TYPE "operation_event_type" AS ENUM('queued', 'claimed', 'progress', 'log', 'completed', 'recovered');--> statement-breakpoint
CREATE TABLE "operation_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "server_id" uuid NOT NULL REFERENCES "server_instances"("id") ON DELETE cascade,
  "operation_id" uuid NOT NULL REFERENCES "operations"("id") ON DELETE cascade,
  "type" "operation_event_type" NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "operation_events_operation_idx" ON "operation_events" USING btree ("operation_id", "id");--> statement-breakpoint
CREATE INDEX "operation_events_server_idx" ON "operation_events" USING btree ("server_id", "id");
