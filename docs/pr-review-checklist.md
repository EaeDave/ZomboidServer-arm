# Control-plane PR review checklist

Before opening the PR from `feat/control-plane-foundation`:

- [ ] `bun run check`, `bun test` and `bun run build` pass under `panel/`.
- [ ] `docker build -f panel/Dockerfile .` passes without copying `node_modules`, `.env`, saves,
      RootFS files or server binaries.
- [ ] PostgreSQL migrations apply cleanly to a fresh database.
- [ ] Login/session cookies are HttpOnly and no password/token is logged or committed.
- [ ] Agent enrollment stores only hashes; the returned access token is handled once.
- [ ] Agent requests are authenticated and operation kinds/payloads are allowlisted.
- [ ] Mutating operations require the correct role and explicit world-reset confirmation.
- [ ] The root-side `pz-agent-priv` allowlist has no arbitrary shell path.
- [ ] The outbound agent unit is disabled until its VPS-only environment file is configured.
- [ ] Staging agent tests cover status, start/stop/restart, logs, backup, mods, settings and reset.
- [ ] Production `zomboid-b42.service` and its saves were not changed during validation.
- [ ] Coolify environment secrets, PostgreSQL backups, health checks and one-replica behavior are
      documented before deployment.

Do not merge or deploy only because the image builds. The staging operation matrix and the manual
Coolify review are release gates.
