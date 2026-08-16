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

python3 - <<'PY' >"$CONSOLE"
for index in range(1, 301):
    print(f"line-{index}")
PY
read -r inode cursor event_cursor < <(initial_console_position)
delta="$(read_console_delta "$cursor" "$inode" 0)"
assert_eq 'line-101' "$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["lines"][0])')" 'initial console state starts at a bounded recent tail'
assert_eq '0' "$event_cursor" 'initial console event cursor starts at zero'

state_file="$TMP_DIR/agent-state/console-cursor"
save_console_state "$state_file" "$inode" 123 456
read -r saved_inode saved_cursor saved_event_cursor < <(read_console_state "$state_file")
assert_eq "$inode" "$saved_inode" 'console state preserves the inode'
assert_eq '123' "$saved_cursor" 'console state preserves the file cursor'
assert_eq '456' "$saved_event_cursor" 'console state preserves the agent cursor'

printf 'live-one\n' >"$CONSOLE"
console_body="$TMP_DIR/console-request.json"
post_console_body() {
  printf '%s' "$4" >"$console_body"
  printf '{"ok":true,"cursor":10}'
}
send_live_console_delta https://panel.example agent token 0 '' 0 0
assert_eq '10' "$LOG_NEXT_EVENT_CURSOR" 'a higher API cursor resynchronizes a restored agent state'
assert_eq 'live-one' "$(python3 - "$console_body" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1]))["lines"][0])
PY
)" 'live console requests carry only the bounded delta'

printf 'pz-agent log cursor tests: ok\n'
