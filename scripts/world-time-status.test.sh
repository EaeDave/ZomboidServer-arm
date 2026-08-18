#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/Server" "$TMP_DIR/mods/zomboid-arm-world-telemetry" \
  "$TMP_DIR/Saves/Multiplayer/servertest"
printf 'version=42.20.3\n' > "$TMP_DIR/console"
printf 'ResetID=1\n' > "$TMP_DIR/Server/servertest.ini"
printf '%s\n' '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}' \
  > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"

export PZ_SERVICE=test-service
export PZ_SERVER_ID=test-service
export PZ_USER="$(id -un)"
export PZ_SERVERNAME=servertest
export PZ_CACHEDIR="$TMP_DIR"
export PZ_INI="$TMP_DIR/Server/servertest.ini"
export PZ_MODS="$TMP_DIR/mods"
export PZ_CONSOLE="$TMP_DIR/console"
export PZ_PORT=16261
export PZ_STEAM_SESSION_CHECK=disabled
export PZ_STEAM_SESSION_STATUS="$TMP_DIR/steam.json"
export SYSTEMD_ACTIVE_ENTER="Sun 2026-08-16 16:30:00 UTC"
export PZ_STATUS_RCON=0


# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/common.sh"
pz_load_env
read_systemctl() {
  if [ "${1:-}" = show ]; then
    case "$*" in
      *ActiveState*) printf 'active\n' ;;
      *SubState*) printf 'running\n' ;;
      *ActiveEnterTimestamp*) printf '%s\n' "$SYSTEMD_ACTIVE_ENTER" ;;
    esac
  fi
}
read_ss() {
  printf 'UNCONN 0 0 0.0.0.0:16261 0.0.0.0:*\n'
}
status_json > "$TMP_DIR/status.json"

jq -e '
  .worldTime.year == 1993 and
  .worldTime.month == 7 and
  .worldTime.day == 9 and
  .worldTime.daysSurvived == 12 and
  .worldTime.worldAgeMinutes == 18030 and
  (.worldCreatedAt | type == "string") and
  (.worldAgeSeconds >= 0)
' "$TMP_DIR/status.json" >/dev/null

# A sidecar from a previous service activation must not be reused after restart.
touch -d '2 days ago' "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
export SYSTEMD_ACTIVE_ENTER="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
status_json > "$TMP_DIR/stale-status.json"
jq -e '.worldTime == null and .worldCreatedAt == null and .worldAgeSeconds == null' \
  "$TMP_DIR/stale-status.json" >/dev/null

echo "world-time-status-test=ok"
