# ADR 0001: Control plane, host agent and Coolify deployment

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

The Project Zomboid server currently runs directly on an Oracle ARM64 VPS. It relies on
systemd, FEX, ciopfs/FUSE, UDP sockets, host files and persistent world data. The future web
panel should be deployable from GitHub through Coolify without giving a web container
unrestricted control of the host.

The project may eventually support multiple users and multiple VPS agents, so PostgreSQL is
chosen now instead of starting with a single-file database.

## Decision

Split the system into two planes:

```text
Coolify control plane (Bun + Elysia + React)
                    │ authenticated private agent protocol
                    ▼
VPS host agent (systemd) → allowlisted operations → pzctl/systemd/PZ/FEX
```

The control plane is built as a Docker image by Coolify. It contains the API, compiled React
assets, authentication, jobs, audit records and PostgreSQL client. It never contains the PZ
server, FEX RootFS, worlds or saves.

The host agent is installed directly on each managed VPS. It owns the privileged boundary and
accepts typed operations only: status, start, stop, restart, logs, backup, mods, settings and
world reset. It does not evaluate arbitrary command strings.

The first transport may be a private authenticated endpoint for local development. The
multi-VPS design should use an outbound agent connection (TLS/WebSocket or long-polling) so a
managed VPS does not need a public administration port.

## Technology choices

- Bun runtime and strict TypeScript.
- Elysia for the API, with TypeBox/Eden-style typed contracts and OpenAPI documentation.
- React + Vite, Tailwind CSS, shadcn/ui, TanStack Query and later TanStack Router.
- oxfmt and oxlint, plus `tsc --noEmit`, Bun tests and Playwright.
- PostgreSQL with migrations and a typed schema package.
- Coolify for image builds, environment secrets, persistent PostgreSQL and deployment hooks.

## Consequences

### Positive

- The PZ/FEX host installation remains compatible with the proven direct-host setup.
- A compromised browser cannot directly execute shell or Docker commands.
- The same agent protocol can serve the CLI, local API and future central panel.
- PostgreSQL supports users, roles, multiple agents, jobs and audit history.
- Coolify can rebuild the control plane on GitHub commits without touching the game process.

### Negative

- There are two deployable components instead of one.
- Agent enrollment, authentication and reconnect behavior must be designed carefully.
- PostgreSQL migrations and backups become part of the release process.
- The web panel cannot assume that a host command completed synchronously; operations need job
  ids and explicit status transitions.

## Rejected alternatives

- **Putting PZ inside the Coolify container:** requires host networking, FUSE and privileged
  mounts, and would weaken isolation while making the ARM/FEX setup harder to reproduce.
- **Giving the panel root SSH or Docker socket access:** too powerful for a public or
  multi-user control plane.
- **SQLite as the primary database:** acceptable for a single-user prototype, but not chosen
  because multi-user/multi-agent operation is a stated future requirement.
- **A full-stack React framework first:** SSR is not needed for an authenticated local panel;
  Vite + Elysia keeps the deployment boundary explicit.
