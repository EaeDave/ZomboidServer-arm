# Structured server configuration panel

## Goals

The web control plane must make Project Zomboid's effective server configuration understandable and safely editable without exposing a host shell or a generic file editor.

The first complete slice covers:

- the full generated `Server/<servername>.ini` surface;
- the full generated `Server/<servername>_SandboxVars.lua` surface, including mod-defined tables;
- online player count and bounded player names from local RCON;
- typed changes with descriptions, validation, revision checks, backups and audit history;
- explicit restart requirements and a review-before-apply workflow;
- production/staging isolation through the existing enrolled server and env-file boundary.

## Trust boundary

```text
React UI
  -> authenticated Elysia API
  -> PostgreSQL operation queue
  -> outbound authenticated pz-agent
  -> root-owned pz-agent-priv allowlist
  -> pzctl / pz-config
  -> configured PZ files
```

The browser never receives a path it can choose, never sends shell text, and never calls systemd or RCON directly. The host derives every path from `PZCTL_ENV` and the installed env file.

## Sources of truth

| Source | Purpose | Panel behavior |
|---|---|---|
| `$PZ_INI` | Multiplayer/server settings | Structured read and typed patch |
| `$PZ_CACHEDIR/Server/${PZ_SERVERNAME}_SandboxVars.lua` | Sandbox and mod settings | Structured read and typed patch |
| `$PZ_INI` `Mods=` + `$PZ_DISABLED` | Active/inactive mod order | Existing mod subsystem; not edited as generic config |
| `$PZ_MANIFEST` + `$PZ_COLLECTIONS` | Workshop metadata | Existing mod subsystem |
| local RCON `players` | Current player count/names | Read-only status telemetry |
| PostgreSQL | Operations, audit and bounded telemetry | Never authoritative for game configuration |

## Dynamic discovery

Project Zomboid regenerates comments containing descriptions, defaults and numeric bounds. Mods add their own sandbox tables. A static list alone would become stale and would silently hide mod settings.

The host parser therefore discovers every scalar setting from the current files and enriches it with:

- source (`server` or `sandbox`);
- stable path (`SleepAllowed`, `ZombieConfig.PopulationMultiplier`, etc.);
- inferred scalar type;
- current value;
- generated description/comment;
- numeric minimum, maximum and default when available;
- category and friendly label from curated overrides or deterministic fallbacks;
- sensitivity and editability;
- restart requirement.

Unknown scalar settings remain visible and editable when they can be validated. Unknown tables or executable Lua expressions are preserved but not rewritten.

## Protected settings

Generic configuration updates must reject identity, infrastructure, secret and mod-load-order keys. They have dedicated workflows or are intentionally host-managed:

- `ResetID`, `ServerPlayerID`, `Seed`;
- ports and announced/public address;
- `Password`, `RCONPassword`, Discord tokens and webhooks;
- `Mods`, `WorkshopItems`, `Map`;
- generated schema/version markers.

Sensitive fields are returned as `configured: true/false`, never with their value. Existing admin-only password reveal remains a separate, audited, no-store flow.

## Read contract

`config.read` is an internal read operation claimed by the agent. The browser calls an authenticated API endpoint; the API waits for the bounded result and never exposes agent credentials.

The result contains:

- a SHA-256 revision over both source files;
- categorized field metadata and current values;
- warnings for unsupported syntax;
- whether any field is sensitive, read-only or requires restart.

## Update contract

`config.update` accepts:

```json
{
  "expectedRevision": "sha256",
  "createBackup": true,
  "changes": [
    { "path": "SleepAllowed", "source": "server", "value": true },
    { "path": "DayLength", "source": "sandbox", "value": 3 }
  ]
}
```

The host must:

1. re-read and hash the files;
2. reject stale revisions;
3. reject duplicate, unknown, protected, sensitive or type-invalid changes;
4. validate numeric bounds when generated metadata provides them;
5. always write timestamped recovery backups before replacing prior state;
6. apply changes to temporary files;
7. parse and validate the temporary results;
8. hold one exclusive configuration lock across read, revision check and write;
9. persist original copies and a transaction journal before replacing either file;
10. replace and fsync both originals, then remove the journal; a later read or update restores both originals if interruption leaves the journal behind;
11. return changed paths, backup paths, the new revision and restart requirement.

No update automatically restarts production. The UI offers a separate restart action after a successful apply.

## Player telemetry and RCON

RCON is a local server-side administration protocol, not a realtime browser connection. It can query live state and execute supported PZ commands, but it must remain bound behind the host boundary.

The agent heartbeat performs a bounded read-only `players` query when RCON is configured. It reports:

- `playerCount` (`-1` when unavailable);
- a bounded list of display names parsed from the server response;
- an availability flag and check time.

Future realtime mutations must be individual typed operations with command-specific validation. A generic browser-to-RCON console is out of scope for the configuration editor.

## UI information architecture

- **Overview:** state, players, build, uptime, runtime, access, mod health, backup/restart notices.
- **Server:** general/access, players, PvP, safehouses/factions, sleep/time, chat/voice/Steam, security.
- **Sandbox:** zombies, loot, world/climate, survival, farming, vehicles, animals, events and per-mod groups.
- **Mods:** installed/configured status, collections, active order, toggle, update and maps.
- **World:** backups and reset.
- **Console:** bounded live server output.
- **Audit:** actor and operation history.

Configuration editing uses a draft. The user searches/filters, edits fields, reviews a semantic diff, applies with mandatory recovery backups, and then chooses whether to restart. Production always receives an explicit confirmation.

## Rollout

1. Parser and host CLI with fixture tests.
2. Typed contracts and agent allowlist.
3. Authenticated API read/update flows with role checks and redacted audit metadata.
4. Modular React configuration experience and dashboard player telemetry.
5. Local checks and browser tests.
6. Deploy only to staging; validate read, stale-revision rejection, update, backup and restart behavior.
7. Open a pull request after the full validation record is attached.
