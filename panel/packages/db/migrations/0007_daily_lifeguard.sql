LOCK TABLE operations IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    server_id,
    row_number() OVER (
      PARTITION BY server_id
      ORDER BY (status = 'running') DESC, created_at DESC, id DESC
    ) AS position
  FROM operations
  WHERE status IN ('queued', 'running')
), recovered AS (
  UPDATE operations
  SET
    status = 'failed',
    error = 'Superseded by a newer active operation during realtime-operation migration.',
    finished_at = now()
  FROM ranked
  WHERE operations.id = ranked.id
    AND ranked.position > 1
    AND operations.status IN ('queued', 'running')
  RETURNING operations.server_id, operations.id
)
INSERT INTO operation_events (server_id, operation_id, type, data)
SELECT
  server_id,
  id,
  'recovered',
  jsonb_build_object('message', 'Operation was recovered as failed during realtime-operation migration.')
FROM recovered;--> statement-breakpoint
CREATE UNIQUE INDEX "operations_active_server_idx" ON "operations" USING btree ("server_id") WHERE status in ('queued', 'running');