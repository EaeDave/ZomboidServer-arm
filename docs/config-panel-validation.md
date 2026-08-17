# Configuration panel validation record

Date: 2026-08-17
Branch: `feat/server-admin-config-panel`

## Local automated validation

- `python3 scripts/pz-config.test.py`: 5/5 passed.
  - dynamic INI/Lua discovery;
  - mod-defined sandbox settings;
  - secret redaction;
  - typed update and backups;
  - stale revision and protected-key rejection;
  - no-op behavior.
- `bun test` in `panel/`: 19/19 passed, 103 assertions.
- `bun run check`: formatting, oxlint and strict TypeScript passed.
- `bun run build`: Vite production build passed.
- Full `panel/Dockerfile` production image build passed, including checks, tests and bundled frontend.
- Host shell syntax checks passed.
- Existing boot, log-cursor and long-running worker tests passed.
- `scripts/pz-agent-large-result.test.sh`: passed with a 609,546-byte result containing 500 fields. This specifically covers Linux's approximately 128 KiB per-argument/environment-string limit by transporting results through stdin.

## Real-file compatibility

Read-only copies of the current host files were parsed with no warnings:

| Instance | Fields | Server INI | Sandbox/Lua | Editable | Warnings |
|---|---:|---:|---:|---:|---:|
| Production | 723 | 144 | 579 | 708 | 0 |
| Staging | 414 | 144 | 270 | 399 | 0 |

Production's serialized structured snapshot is 271,591 bytes. Staging's is 167,137 bytes.

## Staging mutation matrix

The new host scripts were copied to `/tmp/pz-config-validation`; installed production and staging binaries were not replaced. A temporary env file targeted only `/home/ubuntu/Zomboid-staging`.

1. Read the staging snapshot: 414 fields, zero warnings.
2. Confirmed `server:SleepAllowed=false`, editable.
3. Applied `SleepAllowed=true` with `createBackup=true`.
4. Confirmed two timestamped source backups and a new SHA-256 revision.
5. Re-read from disk and confirmed `SleepAllowed=true`.
6. Replayed the update with the old revision and received exit 73 / `stale_revision`.
7. Restored the original INI and Lua.
8. Verified both restored files byte-for-byte with `cmp`.

No production configuration was mutated.

## RCON player telemetry

- Staging, where RCON is unavailable: status completed with `playerCount=-1`, `onlinePlayers=[]`, `rconAvailable=false`.
- Production read-only `players` query: status completed with `playerCount=2`, both current display names, and `rconAvailable=true`.
- The RCON telemetry path uses a two-second timeout, no retry, a maximum of 100 names and never exposes the RCON password.

## UI validation

A production build was served against a local contract-faithful mock API and checked in Chromium:

- authenticated dashboard rendered;
- player count and player-name chips rendered;
- configuration navigation and source/category filters rendered;
- sleep preset changed only `SleepAllowed` for the optional-sleep preset;
- changed-state styling and draft count rendered;
- desktop screenshot at 1280×633 inspected;
- responsive layout at 390×844 inspected;
- browser QA found no console or page errors;
- one intentionally benign failed request was the mock SSE endpoint closing with 204.

Artifacts were saved locally during validation and are not committed.

## Remaining release gate

Before production rollout:

1. push the branch and let GitHub Actions run the same matrix;
2. deploy the branch control-plane and host-agent scripts to the staging instance;
3. exercise browser → API → PostgreSQL → agent → host end-to-end using an authenticated staging account;
4. apply and revert one staging setting from the browser;
5. verify audit rows, operation progress, backup files and restart-required messaging;
6. only then open/merge the PR and schedule production deployment.
