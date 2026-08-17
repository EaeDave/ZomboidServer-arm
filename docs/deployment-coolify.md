# Coolify deployment runbook

This document is the deployment boundary for the web control plane. It does **not** move
Project Zomboid, FEX, the RootFS, worlds or saves into a container.

## Current image configuration

- **Repository:** `EaeDave/ZomboidServer-arm`
- **Branch:** `main`
- **Build context:** repository root
- **Dockerfile:** `panel/Dockerfile`
- **Container port:** `3000`
- **Database:** PostgreSQL managed by Coolify, with persistent storage and backups
- **Replicas:** one until a shared job/agent strategy is implemented

The Dockerfile pins the multi-architecture Bun image digest that can read the Bun 1.4 lockfile.
Update that digest deliberately when moving to a newer Bun release; do not replace it with an
unbounded `latest` tag.

## Environment variables

Set these as Coolify secrets/environment variables, never in Git:

```dotenv
DATABASE_URL=postgresql://...
SESSION_SECRET=<long-random-value>
PUBLIC_URL=https://panel.example.com
AGENT_ENROLLMENT_TOKEN=<one-time-or-rotated-enrollment-value>
AGENT_STALE_SECONDS=60
# Optional: exact Coolify proxy peer IPs, only when it overwrites X-Forwarded-For.
TRUSTED_PROXY_IPS=
PORT=3000
```

`HOST` is set to `0.0.0.0` by the image. The API's default status adapter is fake only in development; production reads the latest
heartbeat stored by PostgreSQL. The host-side `pz-agent --stdio` and outbound `--poll` boundary
supports status plus allowlisted start/stop/restart/logs/backup/mods/settings/world-reset jobs.
`PZ_AGENT_URL` must use HTTPS; `PZ_AGENT_ALLOW_INSECURE=1` is reserved for local testing. The
mutating flows still require staging validation before production access is enabled. Realtime
operation state is stored in PostgreSQL; authenticated SSE emits bounded operation, progress and
log events. The browser never opens a host-log or agent connection.

## Safe rollout sequence

1. Push the tested commit to the selected GitHub branch.
2. In Coolify, create/configure the application with the repository root as the build context and
   `panel/Dockerfile` as the Dockerfile. Set the Docker build arg `VITE_SERVER_ID` to the
   matching host service name (`zomboid-b42-staging` for staging, `zomboid-b42` for production).
3. Provision PostgreSQL separately and attach its persistent volume/backups.
4. Add the environment secrets above; do not upload server passwords, saves, FEX RootFS files or
   SSH private keys to the image.
5. The production start command runs `bun run db:migrate` before the API starts; a failed
   migration must fail the deployment. Do not run schema generation against production. If
   Coolify's reverse proxy is in front of the API, set
   `TRUSTED_PROXY_IPS` to its exact source IP(s) only after confirming it overwrites
   `X-Forwarded-For`; otherwise leave it empty and use the proxy socket address for throttling.
6. Configure the health check as `GET /api/health` on port `3000` and use
   `GET /api/health/database` to verify PostgreSQL.
7. Deploy one replica and verify `/api/health`, `/docs` and the browser bundle.
8. Provision the first admin with the one-off `bun run auth:bootstrap-admin` task, using a long
   password supplied only through Coolify secrets.
9. Enroll the host agent using a short-lived token. The command prints an access token once; store
   it only in the VPS agent environment file:

   ```dotenv
   PZ_AGENT_URL=https://panel.example.com
   PZ_AGENT_ID=<returned-agent-id>
   PZ_AGENT_ACCESS_TOKEN=<returned-access-token>
   PZ_AGENT_INTERVAL=15
   # Optional public address shown to admins; never use this for authentication.
   PZ_PUBLIC_IP=203.0.113.10
   # The first connection publishes this bounded tail; later requests publish only new lines.
   PZ_AGENT_CONSOLE_INITIAL_LINES=200
   PZ_AGENT_PENDING_COMPLETION_RETRIES=3
   # Optional durable dead-letter subdirectory under PZ_CACHEDIR (systemd permits this path).
   PZ_AGENT_STATE_DIR=agent-state
   ```

   The agent stores its console file cursor under `PZ_AGENT_STATE_DIR` and sends only bounded
   deltas. The API retains the newest 2,000 lines per server and exposes them through a separate,
   authenticated SSE stream; a browser never reads the host file directly.

   Rerun the host installer with `PZ_AGENT_ENABLE=1` after configuring this file; that validated
   path installs the narrow sudoers rule and enables the outbound-only unit. Prefer this outbound
   transport or a private Tailscale path; do not expose an unauthenticated systemd, RCON or shell
   port.
10. Test `status` against a staging target before enabling any mutating operation for production.
11. Verify an authenticated `/api/servers/<id>/events/stream` connection receives `ready`,
    heartbeat/status and operation events through the Coolify proxy; confirm reconnects use
    `Last-Event-ID` and that proxy buffering is disabled.
12. Enable production access only after the audit log, role checks, conflict handling and operation
    confirmations are passing.

## Access and credentials

When the implementation is ready, deployment can be performed through the Executor Coolify
integration if it is connected and authorized. SSH is the fallback for host-side installation and
verification, using the configured non-root account and the existing systemd boundary. The panel
will never receive unrestricted root SSH, a Docker socket or arbitrary shell execution.

A production rollout is a separate approval point: building and testing the image does not itself
change the running `zomboid-b42.service`.
