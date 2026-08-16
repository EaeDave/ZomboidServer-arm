#!/usr/bin/env bash
# Isolated behavioural check for the non-blocking Steam Relay telemetry contract.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
printf 'version=42.20.2\n' > "$tmp/console"

cat > "$tmp/bin/sudo" <<'EOF'
#!/bin/sh
exec "$@"
EOF
cat > "$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
if [ "$1" = show ]; then
  case "$*" in
    *ActiveState*) printf 'active\n' ;;
    *SubState*) printf 'running\n' ;;
    *ActiveEnterTimestamp*) printf '%s\n' "$SYSTEMD_ACTIVE_ENTER" ;;
  esac
  exit 0
fi
printf '%s\n' "$*" >> "$BOOT_TEST_CALLS"
EOF
cat > "$tmp/bin/ss" <<'EOF'
#!/bin/sh
printf 'UNCONN 0 0 0.0.0.0:16261 0.0.0.0:*\n'
EOF
cat > "$tmp/bin/timeout" <<'EOF'
#!/bin/sh
shift
exec "$@"
EOF
cat > "$tmp/bin/tcpdump" <<'EOF'
#!/bin/sh
# An empty passive capture is inconclusive, not a failed Relay session.
exit 0
EOF
cat > "$tmp/bin/sleep" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$tmp/bin"/*

export PATH="$tmp/bin:$PATH"
export BOOT_TEST_CALLS="$tmp/calls"
export SYSTEMD_ACTIVE_ENTER="Sun 2026-08-16 16:30:00 UTC"
export PZ_SERVICE="zomboid-test"
export PZ_SERVER_ID="zomboid-test"
export PZ_USER="$(id -un)"
export PZ_PORT=16261
export PZ_CONSOLE="$tmp/console"
export PZ_CACHEDIR="$tmp"
export PZ_STEAM_SESSION_CHECK=observe
export PZ_STEAM_SESSION_STATUS="$tmp/steam.json"
export PZ_STEAM_SESSION_SAMPLE_SECONDS=1

"$repo_dir/scripts/boot-retry.sh" > "$tmp/output"
. "$repo_dir/scripts/common.sh"
pz_load_env
status_json > "$tmp/status.json"

jq -e '
  .steamSession.mode == "observe" and
  .steamSession.evidence == "not_observed" and
  (.steamSession.message | contains("does not prove"))
' "$tmp/status.json" > /dev/null
[ "$(stat -c %a "$tmp/steam.json")" = 644 ]
[ "$(grep -c '^restart zomboid-test$' "$tmp/calls")" -eq 1 ]
grep -q 'LISTENING OK .*not observed, not blocking' "$tmp/output"

# A record from an earlier systemd activation must not be shown as current telemetry.
export SYSTEMD_ACTIVE_ENTER="Sun 2026-08-16 16:31:00 UTC"
status_json > "$tmp/stale-status.json"
jq -e '.steamSession.evidence == "not_checked"' "$tmp/stale-status.json" > /dev/null

echo "boot-retry-observe-and-status-test=ok"
