# ZomboidServer-arm roadmap

This roadmap covers the control plane and web administration work. The Project Zomboid
runtime remains a host-level service managed by systemd/FEX; the web application must never
become a general-purpose shell or Docker host controller.

## Decisions locked

- **Runtime:** Bun.
- **API:** Elysia.
- **Language:** strict TypeScript; pin the newest stable TypeScript release supported by the
  toolchain. The initial scaffold pins TypeScript 7.0.2.
- **Frontend:** React + Vite.
- **UI:** Tailwind CSS + shadcn/ui.
- **Client state:** TanStack Query; TanStack Router when the first real screens land.
- **Tooling:** oxfmt, oxlint, `tsc --noEmit`, Bun test and Playwright for browser flows.
- **Database:** PostgreSQL from the beginning, provisioned by Coolify with persistent backups.
- **Deployment:** Coolify builds the control-plane container from GitHub; the PZ server stays
  on the VPS host.
- **Security boundary:** a host `pz-agent` exposes only allowlisted operations. No arbitrary
  shell, Docker socket, root SSH key or public systemd endpoint.

## Status

| Phase | Status | Goal |
|---|---|---|
| 0. Runtime/reproducibility | Done | FEX reference runtime, Box64 fallback, clean install validation |
| 1. Architecture/tooling | Done | Record ADR, create Bun/Elysia/React/Postgres workspace |
| 2. Operation contract | In progress | Define typed status/start/stop/restart/log/backup/mod/reset actions |
| 3. `pzctl` core refactor | In progress | Make the same operations usable by CLI, agent and tests |
| 4. Host `pz-agent` | In progress | Secure systemd-side service with audit-friendly jobs |
| 5. Local API | In progress | Elysia API, auth, jobs, audit log and agent transport |
| 6. Coolify deployment | Planned | Multi-stage Dockerfile, PostgreSQL migrations, health checks and secrets |
| 7. React panel | In progress | Dashboard, logs, server actions, mods, backups and settings |
| 8. Multi-user/multi-VPS | Planned | Roles, agent enrollment, outbound agent connection and PostgreSQL hardening |

## Current milestone: realtime operations

- [x] Persist operation events, expected target state and durable progress messages.
- [x] Keep long-running host operations out of the heartbeat loop with lease renewal.
- [x] Stream bounded console-log deltas with byte/inode cursors and rotation handling.
- [x] Expose authenticated SSE with `Last-Event-ID`/query-cursor reconnects.
- [x] Reconcile operation history after reload and provide pause/search/autoscroll log UX.
- [x] Reject conflicting queued/running operations and recover expired leases.
- [x] Validate log bounds, cursor idempotency, worker heartbeats, migrations and SSE behavior.
- [x] Add an authenticated outbound WebSocket for correlated, concurrent direct commands.
- [x] Publish the host capability registry to both `pzctl` and the React panel.
- [x] Keep caller-role authorization enforced at the API and again inside the host agent.
- [x] Move RCON, save, settings reads, and config reads off the durable job queue.

The realtime slice is ready for review and staging deployment. Production remains unchanged until
this branch is approved and the migration/agent rollout is explicitly scheduled.

## Current milestone: structured game administration

- [x] Discover and describe all current server INI and Sandbox Lua scalar settings.
- [x] Preserve and expose mod-defined sandbox settings without a static allowlist.
- [x] Redact secrets and protect identity/network/mod-order keys behind dedicated workflows.
- [x] Apply typed patches with bounds, SHA-256 optimistic concurrency, backups and atomic writes.
- [x] Add the authenticated configuration read/update agent contracts and API boundary.
- [x] Add a searchable, categorized, draft/diff configuration workspace with sleep presets.
- [x] Report bounded online-player names and count through local read-only RCON telemetry.
- [x] Manage active/inactive mods and load order through a typed operation.
- [x] Validate local tests, large snapshots, real production reads and reversible staging writes.
- [ ] Deploy the branch to the full staging control plane and run browser-to-host acceptance.

## Follow-up: Workshop update observability

- [ ] Persist a per-run Workshop update audit with each mod's old/new metadata, outcome, error and restart/readiness timeline.
- [ ] Show a concise Mods-page summary that distinguishes queued, checking, updating, restarting, ready, partial and failed states without requiring manual refresh.
- [ ] Add a server-side background check worker with a configurable cadence, cached results and stale/error indicators; prevent duplicate checks and preserve history across reloads.

## Current milestone: foundation

- [x] Choose PostgreSQL instead of SQLite.
- [x] Choose Elysia instead of Hono.
- [x] Choose oxfmt and oxlint.
- [x] Record the control-plane/host-agent boundary.
- [x] Add the initial `panel/` workspace.
- [x] Add the first database migration and PostgreSQL connection health check.
- [x] Define the versioned agent operation protocol and payload allowlist.
- [x] Add a fake agent adapter, status endpoint and React status card.
- [x] Refactor one safe `pzctl` operation (`status`) into a non-interactive JSON command.
- [x] Exercise that command through a local stdio host-agent boundary (status only).
- [x] Add cookie sessions, admin bootstrap and role-bearing authenticated API access.
- [x] Add agent enrollment, hashed access tokens and outbound heartbeat transport.
- [x] Add the first queued `status` operation, agent claim/complete endpoints and audit events.
- [x] Add role checks and the root-side allowlist for start/stop/restart/logs/backup jobs.
- [x] Add non-interactive mods/settings/world-reset adapters and payload validation.
- [ ] Run the complete mutating-operation matrix against a real staging agent.

## Guardrails

1. Do not deploy code to the production VPS until the local API and agent have tests.
2. Do not expose `systemctl`, shell commands, RCON or the PZ admin password directly to the
   browser.
3. Keep production and staging agents as separate targets in PostgreSQL.
4. Use Coolify environment secrets and persistent PostgreSQL storage; never commit `.env`,
   passwords, tokens, saves, RootFS images or proprietary binaries.
5. Every mutating operation gets an id, an allowlisted kind, an actor and an audit record.

## Next checkpoint

The first typed status slice is now covered by the contract package, Elysia endpoint, React status card, non-interactive pzctl JSON commands, PostgreSQL migrations/health
check, cookie sessions, agent enrollment, outbound heartbeats and the first role-checked jobs.
Next, run the complete mutating-operation matrix against a real staging agent, then finish the
Coolify release configuration and PR review checklist.
