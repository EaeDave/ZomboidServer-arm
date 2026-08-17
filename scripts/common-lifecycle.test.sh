#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
EVENTS="$TMP_DIR/events.log"

PZ_SERVICE=test-service
PZ_USER="$(id -un)"
PZ_CACHEDIR="$TMP_DIR/cache"
PZ_CONSOLE="$TMP_DIR/console.txt"
PZ_PORT=16261
mkdir -p "$PZ_CACHEDIR"

. "$ROOT_DIR/scripts/common.sh"
read_systemctl() { printf 'active\n'; }
is_listening() { return 0; }
rcon_ready() { return 0; }
rcon_cmd() { printf 'rcon:%s\n' "$1" >>"$EVENTS"; }
sudo() { printf 'sudo:%s\n' "$*" >>"$EVENTS"; }

graceful_stop_service "Server is restarting for maintenance. Please wait."

python3 - "$EVENTS" <<'PY'
import sys

expected = [
    'rcon:servermsg "Server is restarting for maintenance. Please wait."',
    'rcon:save',
    'rcon:quit',
    'sudo:systemctl stop test-service',
]
actual = open(sys.argv[1], encoding='utf-8').read().splitlines()
assert actual == expected, actual
PY

echo "common lifecycle notice test: ok"
