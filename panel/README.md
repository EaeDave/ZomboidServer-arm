# Zomboid control plane

Initial control-plane workspace for the ZomboidServer-arm project.

## Local development

Requires Bun 1.4+ and PostgreSQL for database-backed work. The foundation slice exposes health endpoints, a typed fake-agent status endpoint, PostgreSQL
sessions/agent enrollment and the first Drizzle migrations. Run `bun run db:migrate` only with a
configured `DATABASE_URL`; create the first account with `bun run auth:bootstrap-admin` using
secrets supplied out of band.

```bash
cp .env.example .env
bun install
bun run check
bun run db:migrate
# Run once with BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD supplied out of band.
bun run auth:bootstrap-admin
bun run db:generate # only when the schema changes
bun run dev:api
# in another terminal
bun run dev:web
```

- API: <http://127.0.0.1:3000/api/health>
- Fake server status (set `PZ_FAKE_AGENT=1` and `PZ_DEV_AUTH_BYPASS=1` for local-only development):
  <http://127.0.0.1:3000/api/servers/zomboid-b42/status>
- Agent enrollment: `POST /api/agents/enroll` (master enrollment token)
- OpenAPI: <http://127.0.0.1:3000/docs>
- Frontend: <http://127.0.0.1:5173>

## Realtime operations

Long-running operations remain durable in PostgreSQL. The heartbeat agent renews a lease while an
update, backup, restart, or reset is active and publishes bounded progress/log deltas. The browser
consumes authenticated SSE events with `Last-Event-ID` reconnection; event retention is bounded,
log cursors are idempotent, and conflicting jobs are rejected with `409`.

Fast commands use a separate authenticated, outbound-only WebSocket from `pz-agent-core`. Each
request has a correlation ID and timeout; the API and host both enforce the caller role. The agent's
capability registry drives the Console UI and `pzctl capabilities`, while the root-owned privileged
wrapper remains the final allowlist. RCON and host files are never exposed to the browser.

## Deployment model

Coolify builds the control-plane image from the repository. The image must not contain the PZ
server, FEX RootFS, worlds or saves. The host `pz-agent` provides narrow, allowlisted operations
over an outbound authenticated transport; mutating access remains staging-gated. See
[`docs/deployment-coolify.md`](../docs/deployment-coolify.md) for Coolify configuration and the
safe rollout sequence.
