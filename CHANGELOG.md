# Changelog

Versions are git tags; every release ships with these notes on the GitHub Releases page.

## v2.1.0 — 2026-08-11 — map mods, faster re-adds, import hardening

### Added
- **Map mod support**: map folders inside installed mods (`media/maps`, `42/media/maps`,
  `common/media/maps`) are detected and added to `Map=` automatically after installs and
  imports — custom maps first, base map (`Muldraugh, KY`) always last. New Mods-menu action
  rebuilds `Map=` from the active mods.
- `MODUPDATE_BACKUP_KEEP=0` disables pre-update world backups (range is now 0-3).

### Changed
- Re-adding an already-installed mod or collection is now instant: one batched Steam call
  classifies every item, current items are skipped, stale ones are re-downloaded as updates.
- World reset regenerates `ResetID` and guarantees a non-empty `ServerPlayerID`.
- README slimmed down; documented the update paths (game vs scripts).

### Fixed
- Importing a foreign `server.ini` no longer copies host-identity keys (`ServerPlayerID`,
  `ResetID`, `Seed`, `SteamVAC`, `server_browser_announced_ip`) — copying these could leave
  clients stuck at "Getting Server Info". Foreign `Map=` entries are filtered to maps that
  exist locally.
- Re-adding a collection no longer re-activates disabled mods or duplicates them across the
  active and disabled lists; their files still get refreshed.

## v2.0.0 — 2026-08-10 — B42 stable, mod auto-updates, pzctl expansion

Repo renamed **zomboid-b42-on-arm → ZomboidServer-arm** (old links redirect).
Everything below was tested end-to-end on a live Oracle Ampere box in an isolated
side-by-side install before release.

### Added
- **Branch selection** in `install.sh`: live branch list from Steam with a built-in
  fallback; `public` (B42 stable) is the default now that the old `unstable` beta
  branch is gone; the choice is remembered for re-runs.
- **Workshop mod auto-updates**: every mod added through `pzctl` is tracked in a
  manifest; `pz-modupdate check|apply|auto` + a systemd timer compare against Steam,
  wait until the server has been empty for a configurable time (player count via
  RCON), take rotating pre-update world backups (1-3 kept, default 2), apply, restart,
  and record everything in a 1000-entry-capped log. Optional check-on-restart mode.
- **pzctl**: mods submenu with multi-remove (`2 5 7-9`), remove-all, reorder
  (`3 1 2` or `5>1`), disable/enable without uninstalling, and import of mods +
  load order + settings from another `server.ini` (file or URL); RCON **admin
  console**; **world reset** with confirmation and backup; **sandbox settings**
  editor with automatic backup/restore; Status now shows every directory the
  server uses plus branch and game version.
- **Raspberry Pi 4/5**: the installer picks the Pi-optimized box64 package.
- Side-by-side/namespaced installs via env overrides (`PZ_SVC`, `PZ_INSTALL_DIR`,
  `PZ_CACHEDIR`, `PZ_PORT`, preseeded answers) — also how the test suite runs.

### Changed
- README rewritten for stable B42: branch table, ARM compatibility matrix, calmer
  uninstall wording.
- `uninstall.sh` covers the new units/scripts, prompts before removing the shared
  DepotDownloader, and follows `PZCTL_ENV` for namespaced installs.
- Shell architecture: shared logic lives in `scripts/common.sh`; `pzctl` and the
  updater both source it and resolve every path from the installer's env file.

### Fixed
- ini edits are injection-safe now: passwords/server names containing `|`, `&` or
  `\` no longer corrupt `servertest.ini` or the systemd unit (admin password is
  validated against characters the unit file can't carry).
- Update lock moved from `/tmp` to the game data dir: Ubuntu's
  `fs.protected_regular` silently blocked the root-run timer from locking a
  user-owned `/tmp` file.
- A failed or busy auto-update keeps the pending flag and retries on the next
  timer tick instead of dropping the update until the next scheduled check.
- Workshop downloads run in a temp dir owned by the game user; the root-run timer
  previously handed DepotDownloader an unwritable directory.
- The RCON client retries once shortly after boot (the RCON socket comes up a few
  seconds after the game port).

## v1.0.0 — 2026-07-03 — initial release

One-command installer + `pzctl` control panel for the Project Zomboid B42
(then `unstable`) dedicated server on ARM64 via box64: DepotDownloader instead of
steamcmd, ciopfs case-insensitivity overlay, tuned box64/JVM flags, hybrid
boot-hang watchdog, restart-until-listening boot loop, local-mod install flow.
