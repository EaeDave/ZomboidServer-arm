#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
CONSOLE="$TMP_DIR/server-console.txt"
COMMON="$TMP_DIR/common.sh"
cat >"$COMMON" <<'EOF'
pz_load_env() {
  PZ_SERVER_ID=test-server
  PZ_SERVICE=test-service
  PZ_CONSOLE="$TEST_CONSOLE"
  PZ_CACHEDIR="$TEST_ROOT"
  PZ_SERVERNAME=servertest
  PZ_STEAM_SESSION_CHECK=observe
  PZ_STEAM_SESSION_STATUS="$TEST_ROOT/steam.json"
  export PZ_SERVER_ID PZ_SERVICE PZ_CONSOLE PZ_CACHEDIR PZ_SERVERNAME PZ_STEAM_SESSION_CHECK PZ_STEAM_SESSION_STATUS
}
EOF

export TEST_CONSOLE="$CONSOLE" TEST_ROOT="$TMP_DIR" PZ_COMMON="$COMMON" PZ_AGENT_SOURCE_ONLY=1
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/pz-agent.sh"

assert_eq() {
  local expected="$1" actual="$2" message="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL: %s (expected %q, got %q)\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

printf 'first\nsecond\npartial' >"$CONSOLE"
read -r inode cursor < <(read_console_position)
delta="$(read_console_delta 0 '' 0)"
assert_eq '13' "$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["cursor"])')" 'complete lines advance the cursor'
assert_eq '2' "$(DELTA="$delta" python3 -c 'import json, os; print(len(json.loads(os.environ["DELTA"])["lines"]))')" 'partial lines wait for a newline'
cursor="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["cursor"])')"

printf '\nthird\n' >>"$CONSOLE"
delta="$(read_console_delta "$cursor" "$inode" 0)"
assert_eq 'partial' "$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["lines"][0])')" 'partial line is completed after rotation-free append'
assert_eq 'third' "$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["lines"][1])')" 'new line is delivered'
cursor="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["cursor"])')"

rm -f "$CONSOLE"
printf 'after-rotation\n' >"$CONSOLE"
delta="$(read_console_delta "$cursor" "$inode" 0)"
assert_eq 'after-rotation' "$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["lines"][0])')" 'inode change resets the cursor'

python3 - <<'PY' >"$CONSOLE"
print("x" * 3000)
PY
delta="$(read_console_delta 0 '' 0)"
assert_eq '2048' "$(DELTA="$delta" python3 -c 'import json, os; print(len(json.loads(os.environ["DELTA"])["lines"][0]))')" 'individual log lines are bounded'

printf 'pz-agent log cursor tests: ok\n'
