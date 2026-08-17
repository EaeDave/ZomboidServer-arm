#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"$TMP_DIR/common.sh" <<'COMMON'
pz_load_env() { :; }
manifest_ids() { [ -f "$PZ_MANIFEST" ] && cut -f1 "$PZ_MANIFEST" || true; }
manifest_row() { [ -f "$PZ_MANIFEST" ] && awk -F '\t' -v id="$1" '$1 == id { print; exit }' "$PZ_MANIFEST" || true; }
ws_details() { printf '1234567\t200\tExample Mod\n'; }
fix_owner() { :; }
ini_get() { :; }
conf_get() { [ "$1" = MODUPDATE_BACKUP_KEEP ] && printf '0' || printf '%s' "$2"; }
svc_active() { [ "${FAKE_ACTIVE:-0}" = 1 ]; }
player_count() { printf '%s\n' "${FAKE_PLAYERS:-0}"; }
install_workshop_item() { return 0; }
log_modupdate() { :; }
rotate_backups() { :; }
backup_world() { printf '%s\n' "$PZ_BACKUPS/modup_test.tar.gz"; }
COMMON

export PZ_COMMON="$TMP_DIR/common.sh"
export PZ_CACHEDIR="$TMP_DIR/cache"
export PZ_MODS="$TMP_DIR/mods"
export PZ_MANIFEST="$TMP_DIR/mods/.workshop-manifest.tsv"
export PZ_BACKUPS="$TMP_DIR/backups"
export PZ_UPDATELOG="$TMP_DIR/mod-updates.log"
export PZ_BOOTRETRY="$TMP_DIR/boot-retry"
mkdir -p "$PZ_CACHEDIR" "$PZ_MODS" "$PZ_BACKUPS"
printf '1234567\t100\tExampleMod\tExample Mod\n' >"$PZ_MANIFEST"

check_json="$TMP_DIR/check.json"
set +e
PZCTL_ENV="$TMP_DIR/unused.env" bash "$ROOT_DIR/scripts/pz-modupdate.sh" check --json >"$check_json"
check_rc=$?
set -e
[ "$check_rc" -eq 10 ]
python3 - "$check_json" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "updates_available"
assert result["trackedCount"] == 1
assert result["updates"] == [{
    "workshopId": "1234567",
    "title": "Example Mod",
    "storedUpdatedAt": 100,
    "availableUpdatedAt": 200,
}]
PY

apply_json="$TMP_DIR/apply.json"
PZCTL_ENV="$TMP_DIR/unused.env" FAKE_ACTIVE=0 bash "$ROOT_DIR/scripts/pz-modupdate.sh" apply --json --no-restart --require-empty >"$apply_json"
python3 - "$apply_json" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "updated"
assert result["updated"] == [{"workshopId": "1234567", "title": "Example Mod"}]
assert result["failed"] == []
assert result["restartRequested"] is False
assert result["restarted"] is False
PY

printf '1234567\t100\tExampleMod\tExample Mod\n' >"$PZ_MANIFEST"
blocked_json="$TMP_DIR/blocked.json"
PZCTL_ENV="$TMP_DIR/unused.env" FAKE_ACTIVE=1 FAKE_PLAYERS=2 bash "$ROOT_DIR/scripts/pz-modupdate.sh" apply --json --require-empty >"$blocked_json"
python3 - "$blocked_json" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
assert result["status"] == "blocked"
assert result["playerCount"] == 2
assert result["updated"] == []
PY

echo "pz-modupdate JSON checks passed"
