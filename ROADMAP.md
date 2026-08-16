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
- [ ] Add role-checked start/stop/restart jobs and complete the remaining pzctl operations.

## Guardrails

1. Do not deploy code to the production VPS until the local API and agent have tests.
2. Do not expose `systemctl`, shell commands, RCON or the PZ admin password directly to the
   browser.
3. Keep production and staging agents as separate targets in PostgreSQL.
4. Use Coolify environment secrets and persistent PostgreSQL storage; never commit `.env`,
   passwords, tokens, saves, RootFS images or proprietary binaries.
5. Every mutating operation gets an id, an allowlisted kind, an actor and an audit record.

## Next checkpoint

The first typed status slice is now covered by the contract package, Elysia endpoint, React status card, non-interactive `pzctl status --json`, PostgreSQL migrations/health
check, cookie sessions, agent enrollment, outbound heartbeats and the first queued status job.
Next, add role-checked start/stop/restart jobs and complete the remaining pzctl operations. No
mutating operation is enabled until it is tested against a real staging agent.
