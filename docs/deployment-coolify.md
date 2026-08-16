# Coolify deployment runbook

This document is the deployment boundary for the web control plane. It does **not** move
Project Zomboid, FEX, the RootFS, worlds or saves into a container.

## Current image configuration

- **Repository:** `EaeDave/ZomboidServer-arm`
- **Branch:** `fex-arm64` (or the release branch selected for the panel)
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
PORT=3000
```

`HOST` is set to `0.0.0.0` by the image. The API's default status adapter is still fake, while the host-side `pz-agent --stdio` boundary
now supports status only. The production deployment must wait for authenticated transport,
agent enrollment and the remaining operation/audit layers to be implemented and tested.

## Safe rollout sequence

1. Push the tested commit to the selected GitHub branch.
2. In Coolify, create/configure the application with the repository root as the build context and
   `panel/Dockerfile` as the Dockerfile.
3. Provision PostgreSQL separately and attach its persistent volume/backups.
4. Add the environment secrets above; do not upload server passwords, saves, FEX RootFS files or
   SSH private keys to the image.
5. Run the migration as a one-off/release task with `bun run db:migrate`; do not run schema
   generation against production.
6. Configure the health check as `GET /api/health` on port `3000` and use
   `GET /api/health/database` to verify PostgreSQL.
7. Deploy one replica and verify `/api/health`, `/docs` and the browser bundle.
8. Enroll the host agent using a short-lived token. Prefer an outbound agent connection or a
   private Tailscale/network path; do not expose an unauthenticated systemd, RCON or shell port.
9. Test `status` against a staging target before enabling any mutating operation for production.
10. Enable production access only after the audit log, role checks and operation confirmations are
    passing.

## Access and credentials

When the implementation is ready, deployment can be performed through the Executor Coolify
integration if it is connected and authorized. SSH is the fallback for host-side installation and
verification, using the configured non-root account and the existing systemd boundary. The panel
will never receive unrestricted root SSH, a Docker socket or arbitrary shell execution.

A production rollout is a separate approval point: building and testing the image does not itself
change the running `zomboid-b42.service`.
