#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

EVENTS="$TMP_DIR/events.log"
cat >"$TMP_DIR/common.sh" <<'COMMON'
pz_load_env() {
  PZ_SERVICE=test-service
  PZ_BOOTRETRY="$TEST_BOOT"
  PZ_CACHEDIR="$TEST_CACHE"
  PZ_CONSOLE="$TEST_CACHE/server-console.txt"
  PZ_RUNTIME=fex
  PZ_BUILDUPDATE="$TEST_CACHE/build-update"
  PZ_PORT=16261
  PZ_SERVERNAME=servertest
  PZ_INI="$TEST_CACHE/server.ini"
  PZ_WORLD_TELEMETRY="$TEST_CACHE/world-time.txt"
  PZ_WORLD_CREATED_AT="$TEST_CACHE/world-created-at"
  export PZ_SERVICE PZ_BOOTRETRY PZ_CACHEDIR PZ_CONSOLE PZ_RUNTIME PZ_PORT PZ_BUILDUPDATE \
    PZ_SERVERNAME PZ_INI PZ_WORLD_TELEMETRY PZ_WORLD_CREATED_AT
}
conf_get() { printf '0\n'; }
ini_set() { :; }
ini_get() { [ "$1" = ServerPlayerID ] && printf '1\n'; }
fix_owner() { :; }
graceful_stop_service() { printf 'graceful-stop:%s\n' "${1:-default}" >>"$TEST_EVENTS"; }
status_json() { printf '%s\n' '{"state":"inactive","listening":false}'; }
rcon_ready() { return 0; }
rcon_cmd() { printf 'response:%s\n' "$1"; }
COMMON
cat >"$TMP_DIR/boot" <<'BOOT'
printf 'boot\n' >>"$TEST_EVENTS"
BOOT
chmod +x "$TMP_DIR/boot"
mkdir -p "$TMP_DIR/cache"
export PZ_COMMON="$TMP_DIR/common.sh" TEST_BOOT="$TMP_DIR/boot" TEST_CACHE="$TMP_DIR/cache" TEST_EVENTS="$EVENTS"

stop_output="$TMP_DIR/stop.json"
PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/pzctl" stop --json >"$stop_output"
[ "$(cat "$stop_output")" = '{"state":"inactive","listening":false}' ]

restart_output="$TMP_DIR/restart.json"
PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/pzctl" restart --json >"$restart_output"
[ "$(cat "$restart_output")" = '{"state":"inactive","listening":false}' ]

python3 - "$EVENTS" <<'PY'
import sys
assert open(sys.argv[1], encoding="utf-8").read().splitlines() == [
    "graceful-stop:default",
    "graceful-stop:Server is restarting for maintenance. Please wait.",
    "boot",
]
PY
mkdir -p "$TMP_DIR/cache/Saves/Multiplayer/servertest"
touch "$TMP_DIR/cache/world-time.txt" "$TMP_DIR/cache/world-created-at" \
  "$TMP_DIR/cache/Saves/Multiplayer/servertest/.zomboid-arm-world-created-at"
reset_output="$TMP_DIR/reset.json"
printf '%s' '{"confirm":true,"createBackup":false}' |
  PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/pzctl" world-reset --json >"$reset_output"
[ "$(cat "$reset_output")" = '{"reset":true,"backupPath":null}' ]
[ ! -e "$TMP_DIR/cache/world-time.txt" ]
[ ! -e "$TMP_DIR/cache/world-created-at" ]
[ ! -e "$TMP_DIR/cache/Saves/Multiplayer/servertest" ]
rcon_output="$TMP_DIR/rcon.json"
printf '%s' '{"command":"servermsg","args":["hello players"]}' |
  PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/pzctl" rcon --json >"$rcon_output"
python3 - "$rcon_output" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "succeeded"
assert result["command"] == "servermsg"
assert result["output"] == 'response:servermsg "hello players"'
PY

if printf '%s' '{"command":"players","args":["unexpected"]}' |
  PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/pzctl" rcon --json >/dev/null 2>&1; then
  echo "pzctl accepted an invalid RCON argument list" >&2
  exit 1
fi

echo "pzctl lifecycle safety test: ok"
