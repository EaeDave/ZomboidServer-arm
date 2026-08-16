# Control-plane PR review checklist

Before opening the PR from `feat/realtime-operations`:

- [x] `bun run check`, `bun test` and `bun run build` pass under `panel/`.
- [x] `docker build -f panel/Dockerfile .` passes without copying `node_modules`, `.env`, saves,
      RootFS files or server binaries.
- [x] PostgreSQL migrations apply cleanly to a fresh database.
- [ ] Login/session cookies are HttpOnly and no password/token is logged or committed.
- [ ] Agent enrollment stores only hashes; the returned access token is handled once.
- [ ] Agent requests are authenticated and operation kinds/payloads are allowlisted.
- [ ] Mutating operations require the correct role and explicit world-reset confirmation.
- [ ] The root-side `pz-agent-priv` allowlist has no arbitrary shell path.
- [ ] The outbound agent unit is disabled until its VPS-only environment file is configured.
- [x] Long-running agent worker heartbeats continue while host commands run.
- [x] Console cursor tests cover partial lines, rotation and per-line bounds.
- [x] Authenticated SSE tests cover initial cursor/reconnect behavior.
- [x] Operation event/log retention and duplicate cursor submissions are bounded/idempotent.
- [ ] Staging agent tests cover `status`, `start`, `stop`, `restart`, `logs`, `backup`,
      `mods.list`, `mods.add`, `mods.remove`, `settings.update` and `world.reset`.
- [x] Production `zomboid-b42.service` and its saves were not changed during validation.
- [x] Coolify environment secrets, PostgreSQL backups, health checks and one-replica behavior are
      documented before deployment.

Do not merge or deploy only because the image builds. The staging operation matrix and the manual
Coolify review are release gates. Production remains unchanged until those gates are explicitly
approved.
