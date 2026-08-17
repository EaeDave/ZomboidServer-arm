#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/cache" "$TMP_DIR/backups" "$TMP_DIR/install" "$TMP_DIR/bin"
export TEST_HOME="$TMP_DIR/home" TEST_CACHE="$TMP_DIR/cache" TEST_BACKUPS="$TMP_DIR/backups" TEST_INSTALL="$TMP_DIR/install"
EVENTS="$TMP_DIR/events.log"
CONSOLE="$TMP_DIR/console.txt"
printf 'version=42.19.0\n' >"$CONSOLE"

cat >"$TMP_DIR/common.sh" <<'COMMON'
pz_load_env() {
  PZ_HOME="$TEST_HOME"
  PZ_CACHEDIR="$TEST_CACHE"
  PZ_BACKUPS="$TEST_BACKUPS"
  PZ_INSTALL="$TEST_INSTALL"
  PZ_CONSOLE="$TEST_CONSOLE"
  PZ_DD="$TEST_DD"
  PZ_BOOTRETRY="$TEST_BOOT"
  PZ_USER="$(id -un)"
  PZ_SERVICE=test-service
  PZ_BRANCH=public
  PZ_PORT=16261
  PZ_GAME_APP_ID=380870
  export PZ_HOME PZ_CACHEDIR PZ_BACKUPS PZ_INSTALL PZ_CONSOLE PZ_DD PZ_BOOTRETRY PZ_USER PZ_SERVICE PZ_PORT PZ_BRANCH PZ_GAME_APP_ID
}
svc_active() { [ "${FAKE_ACTIVE:-1}" = 1 ]; }
is_listening() { [ "${FAKE_LISTENING:-1}" = 1 ]; }
player_count() { printf '%s\n' "${FAKE_PLAYERS:-0}"; }
graceful_stop_service() { printf 'stop\n' >>"$TEST_EVENTS"; }
backup_world() { printf 'backup\n' >>"$TEST_EVENTS"; printf '%s\n' "$PZ_BACKUPS/build-update/build_test.tar.gz"; }
rotate_backups() { :; }
conf_get() { printf '%s\n' "${2:-}"; }
as_user() { "$@"; }
COMMON

cat >"$TMP_DIR/bin/depotdownloader" <<'DOWNLOADER'
#!/usr/bin/env bash
set -euo pipefail
dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = -dir ]; then dir="$2"; shift 2; else shift; fi
done
mkdir -p "$dir"
printf 'new server binary\n' >"$dir/ProjectZomboid64"
printf 'new metadata\n' >"$dir/new-file"
chmod +x "$dir/ProjectZomboid64"
DOWNLOADER
cat >"$TMP_DIR/bin/boot" <<'BOOT'
#!/usr/bin/env bash
printf 'boot\n' >>"$TEST_EVENTS"
printf 'version=42.20.3\n' >>"$TEST_CONSOLE"
BOOT
chmod +x "$TMP_DIR/bin/depotdownloader" "$TMP_DIR/bin/boot"
cat >"$TMP_DIR/bin/cp" <<'CP'
#!/usr/bin/env bash
set -euo pipefail
if [ "${FAIL_CP:-0}" = 1 ]; then
  for arg in "$@"; do
    [[ "$arg" = */new-file ]] && exit 1
  done
fi
exec /bin/cp "$@"
CP
chmod +x "$TMP_DIR/bin/cp"
printf 'old workshop data\n' >"$TMP_DIR/install/steamapps-workshop-marker"

export TEST_CACHE="$TMP_DIR/cache" TEST_BACKUPS="$TMP_DIR/backups" TEST_INSTALL="$TMP_DIR/install"
export TEST_CONSOLE="$CONSOLE" TEST_DD="$TMP_DIR/bin/depotdownloader" TEST_BOOT="$TMP_DIR/bin/boot" TEST_EVENTS="$EVENTS"
export PZ_COMMON="$TMP_DIR/common.sh"

result="$TMP_DIR/result.json"
PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/scripts/pz-build-update.sh" --json >"$result"
python3 - "$result" "$EVENTS" "$TMP_DIR/install/ProjectZomboid64" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "updated", result
assert result["backupCreated"] is True
assert result["restarted"] is True
assert result["previousVersion"] == "42.19.0"
assert result["installedVersion"] == "42.20.3"
assert open(sys.argv[2], encoding="utf-8").read().strip() == "stop\nbackup\nboot"
assert open(sys.argv[3], encoding="utf-8").read().strip() == "new server binary"
PY

printf 'old runtime\n' >"$TMP_DIR/install/old-runtime"
printf 'old server binary\n' >"$TMP_DIR/install/ProjectZomboid64"
chmod +x "$TMP_DIR/install/ProjectZomboid64"
failed="$TMP_DIR/failed.json"
FAIL_CP=1 PATH="$TMP_DIR/bin:$PATH" PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/scripts/pz-build-update.sh" --json >"$failed"
python3 - "$failed" "$EVENTS" "$TMP_DIR/install/old-runtime" "$TMP_DIR/install/ProjectZomboid64" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
event = open(sys.argv[2], encoding="utf-8").read()
runtime = open(sys.argv[3], encoding="utf-8").read()
binary = open(sys.argv[4], encoding="utf-8").read()
assert result["status"] == "failed", result
assert result["backupCreated"] is True
assert event.strip() == "stop\nbackup\nboot\nstop\nbackup\nboot", repr(event)
assert runtime.strip() == "old runtime", repr(runtime)
assert binary.strip() == "old server binary", repr(binary)
PY

blocked="$TMP_DIR/blocked.json"
FAKE_PLAYERS=1 PZCTL_ENV="$TMP_DIR/missing.env" bash "$ROOT_DIR/scripts/pz-build-update.sh" --json >"$blocked"
python3 - "$blocked" "$EVENTS" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "blocked", result
assert result["backupCreated"] is False
assert open(sys.argv[2], encoding="utf-8").read().strip() == "stop\nbackup\nboot\nstop\nbackup\nboot"
PY

echo "pz-build-update safety test: ok"
