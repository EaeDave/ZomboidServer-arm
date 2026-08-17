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
  export PZ_SERVICE PZ_BOOTRETRY PZ_CACHEDIR PZ_CONSOLE PZ_RUNTIME PZ_PORT PZ_BUILDUPDATE
}
conf_get() { printf '0\n'; }
graceful_stop_service() { printf 'graceful-stop:%s\n' "${1:-default}" >>"$TEST_EVENTS"; }
status_json() { printf '%s\n' '{"state":"inactive","listening":false}'; }
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

echo "pzctl lifecycle safety test: ok"
