#!/usr/bin/env bash
#
# pz-build-update — download the configured Project Zomboid server branch, preserving the
# world backup and using the same safe stop/start path as panel lifecycle operations.
#
# JSON mode emits exactly one result object. Expected operational blocks (players online,
# missing DepotDownloader, failed download) are represented in that object and return zero so
# the host agent can persist the useful reason instead of replacing it with an exit code.
set -uo pipefail

ENVF="${PZCTL_ENV:-/etc/zomboid-b42.env}"
export PZCTL_ENV="$ENVF"
[ -f "$ENVF" ] && . "$ENVF"
. "${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}"
pz_load_env

JSON_MODE=0
for arg in "$@"; do
  [ "$arg" = --json ] && JSON_MODE=1
done

APP_ID="${PZ_GAME_APP_ID:-380870}"
BRANCH="${PZ_BRANCH:-public}"

emit_result() {
  BUILD_STATUS="$1" \
  BUILD_BACKUP_PATH="${2:-}" \
  BUILD_RESTARTED="${3:-false}" \
  BUILD_PREVIOUS_VERSION="${4:-}" \
  BUILD_INSTALLED_VERSION="${5:-}" \
  BUILD_MESSAGE="${6:-}" \
  BUILD_APP_ID="$APP_ID" \
  BUILD_BRANCH="$BRANCH" \
    python3 - <<'PY'
import json
import os

result = {
    "status": os.environ["BUILD_STATUS"],
    "appId": os.environ["BUILD_APP_ID"],
    "branch": os.environ["BUILD_BRANCH"],
    "backupCreated": bool(os.environ.get("BUILD_BACKUP_PATH", "")),
    "backupPath": os.environ.get("BUILD_BACKUP_PATH", "") or None,
    "restarted": os.environ.get("BUILD_RESTARTED") == "true",
    "previousVersion": os.environ.get("BUILD_PREVIOUS_VERSION", "") or None,
    "installedVersion": os.environ.get("BUILD_INSTALLED_VERSION", "") or None,
}
message = os.environ.get("BUILD_MESSAGE", "")
if message:
    result["message"] = message[:512]
print(json.dumps(result, separators=(",", ":")))
PY
}

version_from_console() {
  grep -aEo 'version=[0-9][0-9.]*' "$PZ_CONSOLE" 2>/dev/null | tail -1 | cut -d= -f2 || true
}
depot_downloader_available() {
  local -a dd_args=()
  read -r -a dd_args <<< "$PZ_DD"
  [ "${#dd_args[@]}" -gt 0 ] || return 1
  if [ "${dd_args[0]}" = dotnet ]; then
    [ "${#dd_args[@]}" -eq 2 ] && command -v "${dd_args[0]}" >/dev/null 2>&1 && [ -f "${dd_args[1]}" ]
  else
    [ -x "${dd_args[0]}" ]
  fi
}

depot_download() {
  local target="$1"
  local -a dd_args=()
  read -r -a dd_args <<< "$PZ_DD"
  [ "${#dd_args[@]}" -gt 0 ] || return 1
  as_user env HOME="$PZ_HOME" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 \
    "${dd_args[@]}" -app "$APP_ID" -branch "$BRANCH" -os linux -dir "$target"
}

BUILD_ROLLBACK_DIR=""

commit_build_rollback() {
  if [ -n "${BUILD_ROLLBACK_DIR:-}" ]; then
    rm -rf "$BUILD_ROLLBACK_DIR"
    BUILD_ROLLBACK_DIR=""
  fi
}

restore_build_rollback() {
  local rollback="${BUILD_ROLLBACK_DIR:-}" entry base
  [ -n "$rollback" ] && [ -d "$rollback" ] || return 0
  shopt -s dotglob nullglob
  for entry in "$PZ_INSTALL"/*; do
    base="${entry##*/}"
    [ "$base" = steamapps ] && continue
    [ "$entry" = "$rollback" ] && continue
    rm -rf "$entry"
  done
  if [ -d "$PZ_INSTALL/steamapps" ]; then
    for entry in "$PZ_INSTALL/steamapps"/*; do
      base="${entry##*/}"
      [ "$base" = workshop ] && continue
      rm -rf "$entry"
    done
  fi
  for entry in "$rollback"/*; do
    [ "$entry" = "$rollback/steamapps" ] && continue
    mv "$entry" "$PZ_INSTALL/" 2>/dev/null || true
  done
  if [ -d "$rollback/steamapps" ]; then
    mkdir -p "$PZ_INSTALL/steamapps"
    for entry in "$rollback/steamapps"/*; do
      mv "$entry" "$PZ_INSTALL/steamapps/" 2>/dev/null || true
    done
  fi
  shopt -u dotglob nullglob
  rm -rf "$rollback"
  BUILD_ROLLBACK_DIR=""
}

install_downloaded_build() {
  local tmp="$1" entry base rollback_name
  rollback_name=".build-update-rollback.$$.$RANDOM"
  BUILD_ROLLBACK_DIR="$PZ_INSTALL/$rollback_name"
  mkdir -p "$BUILD_ROLLBACK_DIR" || return 1
  shopt -s dotglob nullglob
  for entry in "$PZ_INSTALL"/*; do
    base="${entry##*/}"
    [ "$base" = steamapps ] && continue
    [ "$base" = "$rollback_name" ] && continue
    if ! mv "$entry" "$BUILD_ROLLBACK_DIR/"; then
      restore_build_rollback
      return 1
    fi
  done
  for entry in "$tmp"/*; do
    base="${entry##*/}"
    [ "$base" = steamapps ] && continue
    if ! cp -a "$entry" "$PZ_INSTALL/"; then
      restore_build_rollback
      return 1
    fi
    chown -R "$PZ_USER:$PZ_USER" "$PZ_INSTALL/$base" 2>/dev/null || true
  done
  if [ -d "$tmp/steamapps" ]; then
    mkdir -p "$PZ_INSTALL/steamapps" "$BUILD_ROLLBACK_DIR/steamapps" || {
      restore_build_rollback
      return 1
    }
    for entry in "$PZ_INSTALL/steamapps"/*; do
      base="${entry##*/}"
      [ "$base" = workshop ] && continue
      if ! mv "$entry" "$BUILD_ROLLBACK_DIR/steamapps/"; then
        restore_build_rollback
        return 1
      fi
    done
    for entry in "$tmp/steamapps"/*; do
      base="${entry##*/}"
      [ "$base" = workshop ] && continue
      if ! cp -a "$entry" "$PZ_INSTALL/steamapps/"; then
        restore_build_rollback
        return 1
      fi
      chown -R "$PZ_USER:$PZ_USER" "$PZ_INSTALL/steamapps/$base" 2>/dev/null || true
    done
  fi
  shopt -u dotglob nullglob
  return 0
}



write_result() {
  local status="$1" backup="${2:-}" restarted="${3:-false}" previous="${4:-}" installed="${5:-}" message="${6:-}"
  if [ "$JSON_MODE" = 1 ]; then
    emit_result "$status" "$backup" "$restarted" "$previous" "$installed" "$message"
  else
    printf '%s\n' "${message:-Build update: $status}"
    [ -n "$backup" ] && printf 'World backup: %s\n' "$backup"
  fi
}

start_after_failure() {
  PZ_SERVICE="$PZ_SERVICE" PZ_PORT="$PZ_PORT" PZ_CONSOLE="$PZ_CONSOLE" "$PZ_BOOTRETRY" >/dev/null 2>&1
}

update_build() {
  local previous installed backup_path="" tmp="" was_active=0 players=0 keep

  case "$APP_ID" in ''|*[!0-9]*) write_result unavailable "" false "" "" "Invalid Project Zomboid app id."; return 0 ;; esac
  case "$BRANCH" in ''|*[!A-Za-z0-9._-]*) write_result unavailable "" false "" "" "Invalid Steam branch configuration."; return 0 ;; esac
  [ -d "$PZ_INSTALL" ] || { write_result unavailable "" false "" "" "Server install directory is unavailable."; return 0; }
  depot_downloader_available || { write_result unavailable "" false "" "" "DepotDownloader is unavailable on the host."; return 0; }

  if ! { exec 9>"$PZ_CACHEDIR/.build-update.lock"; } 2>/dev/null; then
    write_result blocked "" false "" "" "Could not open the build update lock."
    return 0
  fi
  if ! flock -n 9; then
    write_result blocked "" false "" "" "Another build update is already running."
    return 0
  fi

  previous="$(version_from_console)"
  if svc_active; then
    was_active=1
    if is_listening; then
      players="$(player_count)"
      if [ "$players" -lt 0 ] 2>/dev/null; then
        write_result blocked "" false "$previous" "" "Player count could not be verified; build update was not started."
        return 0
      fi
      if [ "$players" -gt 0 ] 2>/dev/null; then
        write_result blocked "" false "$previous" "" "The server has players online; wait until it is empty before updating the build."
        return 0
      fi
    fi
  fi

  if ! graceful_stop_service >/dev/null 2>&1; then
    write_result failed "" false "$previous" "" "The server could not be saved and stopped safely."
    return 0
  fi

  keep="$(conf_get BUILDUPDATE_BACKUP_KEEP 3)"
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || keep=3
  [ "$keep" -le 10 ] || keep=10
  if ! backup_path="$(backup_world "$PZ_BACKUPS/build-update" build 2>/dev/null)"; then
    [ "$was_active" -eq 1 ] && start_after_failure || true
    write_result failed "" false "$previous" "" "Could not create the pre-update world backup."
    return 0
  fi
  rotate_backups "$PZ_BACKUPS/build-update" build "$keep" >/dev/null 2>&1 || true

  tmp="$(as_user mktemp -d "$PZ_BACKUPS/.build-download.XXXXXX" 2>/dev/null || true)"
  if [ -z "$tmp" ]; then
    [ "$was_active" -eq 1 ] && start_after_failure || true
    write_result failed "$backup_path" false "$previous" "" "Could not create a temporary build directory."
    return 0
  fi
  trap 'rm -rf "${tmp:-}" >/dev/null 2>&1' EXIT

  if ! depot_download "$tmp" >/dev/null 2>&1; then
    [ "$was_active" -eq 1 ] && start_after_failure || true
    write_result failed "$backup_path" false "$previous" "" "Steam build download failed; the previous server files were kept."
    return 0
  fi

  chmod +x "$tmp/ProjectZomboid64" "$tmp/ProjectZomboid32" "$tmp"/*.sh "$tmp/jre64/bin"/* 2>/dev/null || true
  if [ ! -x "$tmp/ProjectZomboid64" ]; then
    [ "$was_active" -eq 1 ] && start_after_failure || true
    write_result failed "$backup_path" false "$previous" "" "Downloaded build did not contain ProjectZomboid64."
    return 0
  fi

  # Keep the case-insensitive Workshop mount untouched. Root files and Steam metadata are
  # swapped transactionally so a failed copy can restore the previous server build.
  if ! install_downloaded_build "$tmp"; then
    [ "$was_active" -eq 1 ] && start_after_failure || true
    write_result failed "$backup_path" false "$previous" "" "Could not install the downloaded server files; the previous build was restored."
    return 0
  fi

  installed="$previous"
  if [ "$was_active" -eq 1 ]; then
    if ! start_after_failure; then
      restore_build_rollback
      start_after_failure >/dev/null 2>&1 || true
      write_result failed "$backup_path" false "$previous" "" "The new build failed to start; the previous build was restored."
      return 0
    fi
    installed="$(version_from_console)"
    commit_build_rollback
    write_result updated "$backup_path" true "$previous" "$installed" "Project Zomboid build updated and the server restarted."
  else
    commit_build_rollback
    write_result updated "$backup_path" false "$previous" "$installed" "Project Zomboid build updated while the server remained stopped."
  fi

}

update_build
