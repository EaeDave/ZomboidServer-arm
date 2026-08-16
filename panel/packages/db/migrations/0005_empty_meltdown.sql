CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_agent_id_idx" ON "audit_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "operations_queue_idx" ON "operations" USING btree ("server_id","status","created_at");--> statement-breakpoint
CREATE INDEX "operations_actor_user_id_idx" ON "operations" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_instances_service_name_idx" ON "server_instances" USING btree ("service_name");--> statement-breakpoint
CREATE INDEX "server_instances_agent_id_idx" ON "server_instances" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");