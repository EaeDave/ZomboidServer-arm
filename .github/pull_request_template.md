## Summary

- [ ] Describe the control-plane/agent change.
- [ ] State whether production files or services were touched.

## Validation

- [ ] `bun run check` in `panel/`
- [ ] `bun test` in `panel/`
- [ ] `bun run build` in `panel/`
- [ ] `docker build -f panel/Dockerfile .`
- [ ] PostgreSQL migration smoke test
- [ ] Agent operation matrix (status, start/stop/restart, logs, backup, mods, settings, reset)

## Security review

- [ ] No secrets, saves, FEX RootFS, SSH keys or binaries added.
- [ ] Operation is allowlisted and role-checked.
- [ ] Destructive actions require explicit confirmation.
- [ ] No public shell, RCON or systemd endpoint added.

## Deployment

- [ ] Coolify configuration reviewed.
- [ ] Rollback plan documented.
- [ ] Production deploy is explicitly approved separately from merge.
