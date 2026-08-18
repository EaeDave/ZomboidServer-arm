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
export PZ_WORLD_TELEMETRY_MAX_AGE_SECONDS=300

set_active_enter() {
  local value
  value="$(date "$@")" || return 1
  [ -n "$value" ] || return 1
  SYSTEMD_ACTIVE_ENTER="$value"
  export SYSTEMD_ACTIVE_ENTER
}

set_active_enter -u -d '20 minutes ago' '+%Y-%m-%d %H:%M:%S UTC'
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

# A valid alternate slot keeps the last complete snapshot visible if the primary slot is partial.
printf '%s\n' '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}' \
  > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt.next"
printf '%s\n' '{"protocolVersion":1' \
  > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
status_json > "$TMP_DIR/alternate-status.json"
jq -e '.worldTime.year == 1993 and .worldTime.worldAgeMinutes == 18030' \
  "$TMP_DIR/alternate-status.json" >/dev/null
rm -f "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt.next"


# Telemetry newer than this activation but older than the freshness limit is stale.
touch -d '10 minutes ago' "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
set_active_enter -u -d '20 minutes ago' '+%Y-%m-%d %H:%M:%S UTC'

status_json > "$TMP_DIR/aged-status.json"
jq -e '.worldTime == null and (.worldCreatedAt | type == "string") and (.worldAgeSeconds >= 0)' \
  "$TMP_DIR/aged-status.json" >/dev/null



# A non-object telemetry document must be treated as unavailable.
set_active_enter -u '+%Y-%m-%d %H:%M:%S UTC'

printf '%s\n' '[]' > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
status_json > "$TMP_DIR/invalid-telemetry-status.json"
jq -e '.worldTime == null and (.worldCreatedAt | type == "string") and (.worldAgeSeconds >= 0)' \
  "$TMP_DIR/invalid-telemetry-status.json" >/dev/null



# A non-object world marker must fall back to the deterministic directory birth time.
printf '%s\n' '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}' \
  > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
printf '%s\n' '[]' > "$TMP_DIR/Saves/Multiplayer/servertest/.zomboid-arm-world-created-at"
cat > "$TMP_DIR/bin/stat" <<'STAT'
#!/usr/bin/env bash
if [ "${1:-}" = -c ] && [ "${2:-}" = %W ]; then
  printf '1700000000\n'
else
  exec /usr/bin/stat "$@"
fi
STAT
chmod +x "$TMP_DIR/bin/stat"
old_path="$PATH"
export PATH="$TMP_DIR/bin:$PATH"
set_active_enter -u '+%Y-%m-%d %H:%M:%S UTC'
expected_now="$(date +%s)" || exit 1
case "$expected_now" in ''|*[!0-9]*) exit 1 ;; esac
expected_age=$((expected_now - 1700000000))

status_json > "$TMP_DIR/invalid-marker-status.json"
jq -e \
  --argjson lower "$((expected_age - 5))" \
  --argjson upper "$((expected_age + 5))" '

  .worldTime.year == 1993 and
  .worldCreatedAt == "2023-11-14T22:13:20Z" and
  (.worldAgeSeconds >= $lower and .worldAgeSeconds <= $upper)
' "$TMP_DIR/invalid-marker-status.json" >/dev/null

# A future marker is invalid and uses the same deterministic fallback.
printf '%s\n' '{"createdAt":"2999-01-01T00:00:00Z"}' \
  > "$TMP_DIR/Saves/Multiplayer/servertest/.zomboid-arm-world-created-at"
expected_now="$(date +%s)" || exit 1
case "$expected_now" in ''|*[!0-9]*) exit 1 ;; esac
expected_age=$((expected_now - 1700000000))

status_json > "$TMP_DIR/future-marker-status.json"
jq -e \
  --argjson lower "$((expected_age - 5))" \
  --argjson upper "$((expected_age + 5))" '
  .worldCreatedAt == "2023-11-14T22:13:20Z" and
  (.worldAgeSeconds >= $lower and .worldAgeSeconds <= $upper)
' "$TMP_DIR/future-marker-status.json" >/dev/null
export PATH="$old_path"


# A sidecar from a previous service activation must not be reused after restart.
touch -d '2 days ago' "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
touch -d '2 days ago' "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt.next"
set_active_enter -u '+%Y-%m-%d %H:%M:%S UTC'

status_json > "$TMP_DIR/stale-status.json"
jq -e '.worldTime == null and (.worldCreatedAt | type == "string") and (.worldAgeSeconds >= 0)' \
  "$TMP_DIR/stale-status.json" >/dev/null

rm -f "$TMP_DIR/Saves/Multiplayer/servertest/.zomboid-arm-world-created-at" \
  "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt.next"
printf '%s\n' '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}' \
  > "$TMP_DIR/mods/zomboid-arm-world-telemetry/world-time.txt"
cat > "$TMP_DIR/bin/stat" <<'STAT'
#!/usr/bin/env bash
if [ "${1:-}" = -c ] && [ "${2:-}" = %W ]; then
  printf '0\n'
else
  exec /usr/bin/stat "$@"
fi
STAT
chmod +x "$TMP_DIR/bin/stat"
old_path="$PATH"
export PATH="$TMP_DIR/bin:$PATH"
set_active_enter -u '+%Y-%m-%d %H:%M:%S UTC'

status_json > "$TMP_DIR/no-birth-status.json"
export PATH="$old_path"
jq -e '.worldCreatedAt == null and .worldAgeSeconds == null' \
  "$TMP_DIR/no-birth-status.json" >/dev/null
[ ! -e "$TMP_DIR/Saves/Multiplayer/servertest/.zomboid-arm-world-created-at" ]

echo "world-time-status-test=ok"
