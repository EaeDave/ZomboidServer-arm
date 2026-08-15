# Design notes: B42-stable transition, mod auto-updates, pzctl expansion

Date: 2026-08-10. These are the working design notes behind the 2026-08 update; the
README is the user-facing documentation. Kept for the "why" behind the decisions.

## 1. Context

Project Zomboid Build 42 left the `unstable` beta and is now the default `public` branch on
Steam (verified live on 2026-08-10 via app 380870 depot info):

| Branch | Content | Notes |
|---|---|---|
| `public` | B42 stable (42.20.x) | default, most recently updated build |
| `42.19` | Build 42.19.1 | pinned older stable |
| `legacy41` | Build 41.78.20 | old B41 |
| `outdatedunstable` | pre-stable B42 | "fallback branch for rollbacks and prior saves" |

The `unstable` branch no longer exists, so the installer's hardcoded `-branch unstable` is
broken and must go.

Reference environment (Oracle Ampere, surveyed 2026-08-10): Ubuntu 24.04.4, aarch64, 4 cores,
24 GB RAM plus 4 GB swap, python3 3.12, server v42.20.2 from `/opt/zomboid-server` (~7 GB),
the bundled x86-64 Java 25 runtime, and local mods only (`WorkshopItems=` empty). The primary
runtime is FEX commit `a08a6ce5de51f5e625357ecaed46c463aa1e3c99`, with Ubuntu 24.04 x86-64
RootFS and `FEX_MULTIBLOCK=0`; Box64 v0.4.3 is retained as a fallback, not as the reference
runtime. The live runtime was validated with 10 GB for the server and Steam Relay clients;
the clean installer validation is deliberately performed in an isolated namespace so a
production install on the same machine is not touched or stopped.

## 2. Goals

1. Branch selection in the interactive installer; `public` (B42 stable) is the default.
2. Workshop mod auto-update system: manual check/apply, optional check-on-restart, scheduled
   automatic updates that wait for an empty server, pre-update world backups (rotated, max 1-2,
   default 2), and a capped update log (1000 entries).
3. pzctl growth: world reset; mods submenu with multi-remove, remove-all, reorder,
   disable/enable, import from a foreign `server.ini`; RCON admin console; sandbox settings
   editor; directory paths in Status.
4. README: B42-stable wording, softer uninstall warning, fewer em dashes, ARM compatibility +
   general-specs section, new repo name **ZomboidServer-arm** everywhere.
5. Portability: state clearly what the scripts need (aarch64 + apt + systemd), fail early
   otherwise, use pinned FEX by default, and keep the right Box64 package available for the
   fallback path on Raspberry Pi.

## 3. Architecture decisions

### 3.1 Shared library + env file as the single source of truth

`pzctl`, the updater, and boot scripts start sharing non-trivial logic (workshop download,
manifest, ini editing). New layout, all installed by `install.sh`:

```
/usr/local/bin/pzctl                  menu UI (thin; sources common.sh)
/usr/local/sbin/pz-boot-retry         unchanged role
/usr/local/sbin/zomboid-watchdog.sh   unchanged role
/usr/local/sbin/pz-modupdate          updater CLI: check | apply | auto
/usr/local/lib/zomboid-arm/common.sh  shared: env loading, workshop install, manifest, ini edit
/usr/local/lib/zomboid-arm/pz-rcon.py stdlib-only Source-RCON client (python3)
```

`/etc/zomboid-b42.env` gains `PZ_BRANCH`, `PZ_PORT`, `PZ_CACHEDIR`, `PZ_CONF`, and the
installed-file paths, so every script resolves everything from the env file. `pzctl` and
`pz-modupdate` accept `PZCTL_ENV=<path>` to point at an alternate env file (this is what makes
same-box test installs possible).

User-tunable settings that must survive reinstalls live in `$PZ_CACHEDIR/pzctl.conf`
(user-writable, plain `KEY=value`):

```
MODUPDATE_AUTO=0|1          scheduled auto-update on/off        (default 0)
MODUPDATE_SCHED=daily|weekly cadence of the scheduled check     (default daily)
MODUPDATE_ON_RESTART=0|1    check+apply before pzctl restarts   (default 0)
MODUPDATE_EMPTY_MIN=60      server must be empty this long      (default 60)
MODUPDATE_BACKUP_KEEP=2     pre-update backups kept (1 or 2)    (default 2)
```

### 3.2 Multi-instance / test namespace (env-driven, defaults unchanged)

`install.sh` reads optional env overrides; when unset, behavior is byte-identical to today:

```
PZ_SVC          service base name        (default zomboid-b42)
PZ_INSTALL_DIR  server files             (default /opt/zomboid-server)
PZ_CACHEDIR     Zomboid data dir         (default $HOME/Zomboid; passed as -cachedir when non-default)
PZ_PORT         game port                (default 16261; passed as -port/-udpport when non-default)
PZ_SKIP_FIREWALL=1  skip iptables step
PZ_RUNTIME      fex|box64                backend (default fex)
PZ_FEX_*        commit/prefix/RootFS    pinned FEX settings
PZ_BRANCH       preseed branch (skips the prompt)
PZ_ADMIN_PW / PZ_JOIN_PW / PZ_RAM_GB    preseed the other prompts (non-interactive installs)
```

Non-default `PZ_SVC` suffixes every installed artifact (units, env file, pzctl, sbin scripts,
lib dir) so a test install coexists with production without overwriting production's scripts.
Unit names derive from `PZ_SVC`: `<svc>.service`, `<svc>-ciopfs.service`, `<svc>-watchdog.*`,
`<svc>-modupdate.*`.

FEX is the default backend and launches the bundled x86-64 server explicitly through
`FEXLoader`; its prefix, RootFS, data home and server socket are namespaced/configurable.
The Box64 fallback is the only path that installs Box64, registers `binfmt_misc`, or modifies
`/etc/box64.box64rc`.

### 3.3 Branch selection

At install time, fetch the live branch list from
`https://api.steamcmd.net/v1/info/380870` (8 s timeout, `jq` already a dependency). On any
failure fall back to the static list from §1. Present a numbered menu, Enter = `public`,
labeled "B42 stable (recommended)". `legacy41` and `outdatedunstable` get one-line warnings
(different save format / rollback-only). Chosen branch is recorded as `PZ_BRANCH` in the env
file; re-running the installer offers the recorded branch as the default. DepotDownloader is
always called with `-branch "$PZ_BRANCH"` (`public` is valid).

### 3.4 Mod update system

**Manifest** `$PZ_MODS/.workshop-manifest.tsv`, one line per workshop item:
`<workshop_id>\t<time_updated>\t<mod_id,mod_id>\t<title>`. Written/updated whenever
`install_workshop_item` succeeds; `time_updated` and `title` come from Steam's public
`GetPublishedFileDetails` POST API. Mods installed before this feature have no manifest row;
re-adding the same mod/collection URL rebuilds their rows (documented in README).

**pz-modupdate check** batches all manifest IDs into one API call, compares `time_updated`,
prints outdated items, exit 0 = up to date / 10 = updates available.
**pz-modupdate apply** takes a world backup into `$PZ_HOME/pz_backups/mod-update/` (rotate to
`MODUPDATE_BACKUP_KEEP`), re-downloads each outdated item via the shared installer function,
appends one line per updated mod to `$PZ_CACHEDIR/mod-updates.log`
(`YYYY-MM-DD HH:MM | <wid> | <title> | old -> new`), trims the log to its last 1000 lines,
and restarts the server through `pz-boot-retry` (flag to skip restart when the caller handles it).
**pz-modupdate auto** is the timer entrypoint: consults `pzctl.conf`; runs the API check when
the daily/weekly stamp is due; when updates are pending it queries player count via RCON
`players` and only applies once the server has been continuously empty for
`MODUPDATE_EMPTY_MIN` minutes (state kept in `$PZ_CACHEDIR/.modupdate-state`; any player
sighting resets the clock; RCON unreachable = do nothing, try next tick).

**Timer** `<svc>-modupdate.timer`: every 30 min, `Persistent=true`; the service runs as the
game user. The timer is always installed but the script exits immediately unless
`MODUPDATE_AUTO=1`.

**Check-on-restart**: pzctl's Restart action runs `pz-modupdate check` first when
`MODUPDATE_ON_RESTART=1` and applies updates before booting (restart already implies downtime,
so no empty-server wait).

**RCON dependency**: player-count detection needs RCON. Enabling auto-update through pzctl
also sets `RCONPassword` (random, stored only in the ini) if empty. RCON listens on TCP
`RCONPort` (test: non-default port; prod default 27015) and is NOT opened in any firewall,
so it stays box-local on cloud hosts.

### 3.5 pzctl menu

Top level (Status merged with paths; Mods and Updates become submenus):

```
1 Start   2 Stop   3 Restart   4 Status+paths   5 Live logs
6 Mods    7 Admin console (RCON)   8 Settings   9 Backup world
10 World reset   11 Sandbox settings   12 Mod-update settings   0 Exit
```

**Mods submenu** (loops until Back): add mod/collection; list (disabled mods shown as `[off]`);
remove — accepts multiple selections `2 5 7-9` and stays in the submenu; remove ALL (confirm;
files kept); reorder (`3 1 2` full order, or `5>1` single move, repeatable); disable/enable
(disabled ids move between `Mods=` and `$PZ_MODS/.disabled-mods`, order remembered); import
from another server.ini; check updates now; apply updates now.

**Import from server.ini**: input = local path or http(s) URL. Reads the foreign `Mods=` and
`WorkshopItems=`; downloads every workshop item as a LOCAL mod (existing machinery), then sets
`Mods=` to the foreign order (mods that failed to download are dropped with a warning) and
keeps `WorkshopItems=` empty (EResult-33 crash-loop avoidance, same policy as add-mod).
Then offers "also copy server settings?": if yes, every `Key=value` from the foreign ini is
applied EXCEPT the identity/network keys `DefaultPort, UDPPort, RCONPort, RCONPassword,
Password, PublicName, SteamPort1, SteamPort2, server browser announce fields` (kept from the
current ini) and `WorkshopItems` (forced empty). A timestamped `.bak` of the current ini is
written first.

**Admin console**: requires RCON (offers to enable + restart if off). Interactive loop sending
commands via `pz-rcon.py`; `players`, `servermsg`, `save` etc. work. Commands that stop the
server (`quit`) are intercepted with a warning that systemd will auto-restart it (that is also
why the feature is safe: worst case equals a restart). Live logs stays a separate menu item.

**World reset**: stop server, optional backup, delete `Saves/Multiplayer/<servername>*` and
`db/<servername>.db` under `$PZ_CACHEDIR`, keep ini + sandbox settings, start server. Requires
typing `RESET` to confirm.

**Sandbox settings**: edit `<servername>_SandboxVars.lua` in `$EDITOR`/nano after writing a
timestamped backup; menu offers restore-last-backup. (A structured editor for 58 KB of lua is
out of scope; the file + in-game admin panel remain the real editors.)

**Status** additionally prints: install dir, data dir, ini path, sandbox file, mods dir,
workshop dir, console log, backups dir, update log, env file, branch, game version (from
console log).

### 3.6 Portability / runtime requirements (README + install.sh guards)

- Hard requirements: aarch64, systemd, apt (Debian/Ubuntu family). `install.sh` now also
  checks for `apt-get` and exits with a clear message on non-apt distros.
- FEX is the default and is pinned to the Oracle-tested commit. It needs a local build and an
  x86-64 Ubuntu RootFS; FEX is launched directly and does not use `binfmt_misc`.
- Box64 is a selectable fallback. Only that backend needs the Box64 apt package, the
  `binfmt_misc` registration, and the `[ProjectZomboid64]` block in `/etc/box64.box64rc`.
- RAM: warn (not fail) below 6 GB total; default `-Xmx` calculation unchanged.
- Disk: ~10 GB free needed (6.9 GB server + JRE + mods); checked with a warning.
- Raspberry Pi 4/5 detected via `/proc/device-tree/model` → when Box64 is selected, install
  `box64-rpi4arm64` / `box64-rpi5arm64` instead of `box64-generic-arm` (same apt repo).
- README gets a short "Will it run on my ARM box?" table: Oracle Ampere (tested), AWS
  Graviton/Hetzner/other aarch64 Ubuntu VPS (expected fine), RPi 4/5 8 GB (works, small
  groups), non-apt distros & 32-bit ARM (unsupported).

### 3.7 README & repo rename

Title/clone URLs switch to `ZomboidServer-arm`; B42 described as stable (with branch menu
documented); pzctl menu screenshot refreshed; mod auto-update + console + reset + import
documented; uninstall warning reworded to a calm "it removes X, Y; it asks before deleting
worlds" tone; em dashes thinned out to commas/periods except where genuinely needed.
GitHub rename executed via authenticated `gh repo rename` (old URLs auto-redirect), local
`origin` updated. `uninstall.sh` learns about the new units/files/paths.

## 4. Testing record (isolated namespace on the reference box)

The disposable clean-install validation completed successfully on the Oracle reference host;
this was a side-by-side host test, not a pristine-OS test. The published fork commit
`7fd584c` was cloned into a temporary checkout and installed as `zomboid-b42-clean` with
`/home/ubuntu/Zomboid-clean/` and `/opt/zomboid-server-clean/`, ports `17261/17262`, RCON
`27261`, FEX, a 4 GiB JVM limit, `CPUQuota=200%`, `MemoryMax=6G` and `Nice=10`.

The production service stayed active throughout: its PID remained `2804567`, its active-start
timestamp did not change, UDP `16261/16262` stayed bound, and its systemd journal had no
restart entries. The test reached `SERVER STARTED` with Steam enabled. After both Oracle VCN
rules and the matching local `iptables` rules were present, an external client connected
through Steam Relay and reached the game world.

The test namespace, units, helper scripts, data, logs, temporary local firewall rules and
checkout were removed afterward. The shared production FEX prefix, RootFS and DepotDownloader
were preserved. During the installer-applied settings restart, the old test JVM needed the
systemd stop timeout and emitted the known FEX shutdown `SIGBUS`; the replacement instance
started normally and was the one used for the successful client connection.

The broader mod-update, RCON, world-reset and full pzctl workflow tests remain a separate
validation task; they are not being presented as completed by this install smoke test.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Test install overwrites prod scripts/units | namespace suffixes every artifact; prod files never written |
| Second server steals CPU from players | CPUQuota+Nice on test unit; load checked between steps; test server stopped when idle |
| FEX rebuild changes the production runtime | use a separate test prefix/source; never rebuild `/opt/fex-a08` while production is running |
| Box64 setup changes global binfmt/config | FEX test skips Box64 setup; Box64 fallback testing is a separate, explicit run |
| Steam page scrape (collections) breaks someday | unchanged behavior, documented; API fallback already impossible for unlisted |
| api.steamcmd.net down at install time | static branch fallback list |
| RCON exposed | never firewall-opened; random password; documented |
| `sed` injection via passwords/names in ini edits | shared `ini_set` escapes replacement text (fixes an existing bug) |
| CRLF/BOM from Windows dev machine | `.gitattributes` forces LF; deploy via scp |

## 6. Out of scope

Multi-server orchestration UI, structured sandbox editor, automatic server-file (game build)
updates, non-apt distros, box86/32-bit, migrating pre-existing local mods into the manifest
(covered by re-adding collection URLs when the user chooses).

## 7. Addendum (2026-08-11): map mods + import hardening

Field feedback after the release surfaced four issues:

- **`Map=` was never managed**, so map mods installed but their cells never loaded. B42 mods
  ship maps under `<Mod>/media/maps/<Name>`, `<Mod>/42/media/maps/<Name>` or
  `<Mod>/common/media/maps/<Name>`. pzctl now scans active mods, appends missing map names to
  `Map=` after installs/imports (custom maps first, base map `Muldraugh, KY` always last),
  and the Mods menu can rebuild the whole line from scratch.
- **Importing a foreign ini copied identity keys.** `ServerPlayerID` (arrived empty),
  `SteamVAC`, `ResetID`, `Seed` and `server_browser_announced_ip` are exactly the keys that
  can stall clients at "Getting Server Info"; they joined the never-copy list, and foreign
  `Map=` entries are now filtered to maps that actually exist locally (base map appended).
- **Re-adding an installed mod/collection re-downloaded everything** and re-activated
  disabled mods, duplicating them across `Mods=` and the disabled list. One batched Steam
  call now classifies every item as current/stale/missing: current items are skipped
  (instant), stale ones are re-downloaded as updates, and disabled mods get their files
  refreshed without being re-activated.
- **World reset** now regenerates `ResetID` (and guarantees a non-empty `ServerPlayerID`),
  matching what the game itself does on a wipe. `MODUPDATE_BACKUP_KEEP` accepts `0` to skip
  pre-update backups entirely.
