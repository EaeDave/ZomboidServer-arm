#!/usr/bin/env bash
#
# pz-agent — narrow stdio boundary for the host control plane.
#
# The outbound --poll mode never opens a listening port on the VPS. It sends heartbeats and
# claims only typed, allowlisted jobs; mutating jobs must be validated in staging before use.
set -uo pipefail

PZCTL_BIN="${PZCTL_BIN:-/usr/local/bin/pzctl}"
PZ_AGENT_PRIV="${PZ_AGENT_PRIV:-/usr/local/sbin/pz-agent-priv}"
PZ_COMMON="${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}"

[ -r "$PZ_COMMON" ] || {
  printf 'pz-agent: common library not found: %s\n' "$PZ_COMMON" >&2
  exit 1
}
. "$PZ_COMMON"
pz_load_env

require_secure_url() {
  case "$1" in
    https://*) ;;
    http://*)
      [ "${PZ_AGENT_ALLOW_INSECURE:-0}" = "1" ] || {
        printf 'pz-agent: HTTPS is required (set PZ_AGENT_ALLOW_INSECURE=1 only for local testing)\n' >&2
        return 64
      }
      ;;
    *)
      printf 'pz-agent: PZ_AGENT_URL must use https://\n' >&2
      return 64
      ;;
  esac
}

agent_help() {
  cat <<'EOF'
Usage: pz-agent [--status | --stdio | --enroll | --poll | --help]

--status  emit the local pzctl status JSON and exit
--stdio   read one versioned status request JSON object per line and emit one response per line
--enroll  exchange AGENT_ENROLLMENT_TOKEN for a one-time access token (prints JSON)
--poll    send authenticated heartbeats and process typed jobs until stopped
EOF
}

error_response() {
  local request_id="${1:-}" server_id="${2:-$PZ_SERVER_ID}" kind="${3:-status}" code="$4" message="$5"
  RESPONSE_REQUEST_ID="$request_id" \
  RESPONSE_SERVER_ID="$server_id" \
  RESPONSE_KIND="$kind" \
  RESPONSE_CODE="$code" \
  RESPONSE_MESSAGE="$message" \
  python3 - <<'PY'
import json
import hashlib
import os

print(
    json.dumps(
        {
            "protocolVersion": 1,
            "requestId": os.environ["RESPONSE_REQUEST_ID"],
            "serverId": os.environ["RESPONSE_SERVER_ID"],
            "kind": os.environ["RESPONSE_KIND"],
            "ok": False,
            "error": {
                "code": os.environ["RESPONSE_CODE"],
                "message": os.environ["RESPONSE_MESSAGE"],
            },
        },
        separators=(",", ":"),
    )
)
PY
}

validate_request() {
  local line="$1"
  AGENT_SERVER_ID="$PZ_SERVER_ID" python3 - "$line" <<'PY'
import json
import os
import sys

expected_server = os.environ["AGENT_SERVER_ID"]
line = sys.argv[1]


def reject(code, message, request_id="", server_id=expected_server, kind="status"):
    print(
        json.dumps(
            {
                "protocolVersion": 1,
                "requestId": request_id,
                "serverId": server_id,
                "kind": kind,
                "ok": False,
                "error": {"code": code, "message": message},
            },
            separators=(",", ":"),
        )
    )
    raise SystemExit(1)

try:
    request = json.loads(line)
except json.JSONDecodeError:
    reject("invalid_json", "request must be one JSON object per line")

if not isinstance(request, dict):
    reject("invalid_request", "request must be a JSON object")

request_id = request.get("requestId", "")
server_id = request.get("serverId", expected_server)
kind = request.get("kind", "status")
if not isinstance(request_id, str) or not request_id:
    reject("invalid_request_id", "requestId is required", kind=kind if isinstance(kind, str) else "status")
if not isinstance(server_id, str) or server_id != expected_server:
    reject("wrong_server", "request targets a different server", request_id, str(server_id), str(kind))
if request.get("protocolVersion") != 1:
    reject("unsupported_protocol", "protocolVersion must be 1", request_id, server_id, str(kind))
if kind != "status":
    reject("operation_disabled", "only status is enabled", request_id, server_id, str(kind))
if request.get("payload") != {}:
    reject("invalid_payload", "status payload must be an empty object", request_id, server_id, kind)
if set(request) != {"protocolVersion", "requestId", "serverId", "kind", "payload"}:
    reject("invalid_request", "unknown request fields are not accepted", request_id, server_id, kind)

print(json.dumps({"requestId": request_id, "serverId": server_id}, separators=(",", ":")))
PY
}

agent_mods_status_json() {
  PZ_INI_PATH="${PZ_INI:-}" PZ_DISABLED_PATH="${PZ_DISABLED:-}" PZ_MANIFEST_PATH="${PZ_MANIFEST:-}" PZ_COLLECTIONS_PATH="${PZ_COLLECTIONS:-}" python3 - <<'PY'
import json
import os

def value(path, key):
    try:
        with open(path, encoding="utf-8", errors="replace") as source:
            for line in source:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""

def split(raw, separators):
    values = [raw]
    for separator in separators:
        values = [part for value in values for part in value.split(separator)]
    return list(dict.fromkeys(part.strip() for part in values if part.strip()))

ini = os.environ["PZ_INI_PATH"]
disabled_path = os.environ["PZ_DISABLED_PATH"]
try:
    with open(disabled_path, encoding="utf-8", errors="replace") as source:
        inactive = list(dict.fromkeys(line.strip() for line in source if line.strip()))
except OSError:
    inactive = []
active = split(value(ini, "Mods"), ";,")
active_set = set(active)
items = []
try:
    with open(os.environ["PZ_MANIFEST_PATH"], encoding="utf-8", errors="replace") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 4 or not fields[0].isdigit() or not fields[3].strip():
                continue
            mod_ids = split(fields[2], ",")
            if active_set.intersection(mod_ids):
                items.append({"workshopId": fields[0], "title": fields[3].strip()[:256], "modIds": mod_ids[:100]})
except OSError:
    pass
collections = []
try:
    with open(os.environ["PZ_COLLECTIONS_PATH"], encoding="utf-8", errors="replace") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t", 1)
            if fields and fields[0].isdigit() and 6 <= len(fields[0]) <= 20:
                collections.append({"id": fields[0], "title": (fields[1].strip() if len(fields) > 1 else f"Collection {fields[0]}")[:256]})
except OSError:
    pass
print(json.dumps({"collections": collections[:50], "configuredItems": items[:500], "workshopIds": [item["workshopId"] for item in items[:500]], "activeModIds": active[:1000], "inactiveModIds": inactive[:1000]}, separators=(",", ":")))
PY
}

agent_settings_status_json() {
  PZ_INI_PATH="${PZ_INI:-}" PZ_PUBLIC_IP="${PZ_PUBLIC_IP:-}" PZ_DEFAULT_PORT="${PZ_PORT:-16261}" python3 - <<'PY'
import json
import os

def value(path, key):
    try:
        with open(path, encoding="utf-8", errors="replace") as source:
            for line in source:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""

ini = os.environ["PZ_INI_PATH"]
default_port = value(ini, "DefaultPort") or os.environ["PZ_DEFAULT_PORT"]
udp_port = value(ini, "UDPPort") or "16262"
try:
    default_port = int(default_port)
except ValueError:
    default_port = 16261
try:
    udp_port = int(udp_port)
except ValueError:
    udp_port = 16262
public_address = value(ini, "server_browser_announced_ip") or os.environ["PZ_PUBLIC_IP"] or None
print(json.dumps({
    "public": value(ini, "Public").lower() != "false",
    "publicName": value(ini, "PublicName") or None,
    "passwordConfigured": bool(value(ini, "Password")),
    "defaultPort": default_port,
    "udpPort": udp_port,
    "publicAddress": public_address,
}, separators=(",", ":")))
PY
}

agent_status_json() {
  local status="" mods settings
  if [ -x "$PZ_AGENT_PRIV" ] && command -v sudo >/dev/null 2>&1; then
    if status="$(sudo -n "$PZ_AGENT_PRIV" status 2>/dev/null)"; then
      :
    else
      status=""
    fi
  fi
  [ -n "$status" ] || status="$("$PZCTL_BIN" status --json)" || return 1
  mods="$(agent_mods_status_json)" || return 1
  settings="$(agent_settings_status_json)" || return 1
  STATUS="$status" MODS="$mods" SETTINGS="$settings" python3 - <<'PY'
import json
import os

status = json.loads(os.environ["STATUS"])
status["mods"] = json.loads(os.environ["MODS"])
status["settings"] = json.loads(os.environ["SETTINGS"])
print(json.dumps(status, separators=(",", ":")))
PY
}

respond_status() {
  local line="$1" metadata status
  if ! metadata="$(validate_request "$line")"; then
    printf '%s\n' "$metadata"
    return 0
  fi

  if ! status="$(agent_status_json 2>/dev/null)"; then
    local request_id server_id
    request_id="$(META="$metadata" python3 -c 'import json, os; print(json.loads(os.environ["META"])["requestId"])')"
    server_id="$(META="$metadata" python3 -c 'import json, os; print(json.loads(os.environ["META"])["serverId"])')"
    error_response "$request_id" "$server_id" status status_unavailable "local status command failed"
    return 0
  fi

  META="$metadata" STATUS="$status" python3 - <<'PY'
import json
import os

meta = json.loads(os.environ["META"])
status = json.loads(os.environ["STATUS"])
if status.get("serverId") != meta["serverId"]:
    print(
        json.dumps(
            {
                "protocolVersion": 1,
                "requestId": meta["requestId"],
                "serverId": meta["serverId"],
                "kind": "status",
                "ok": False,
                "error": {
                    "code": "status_identity_mismatch",
                    "message": "local status returned a different server id",
                },
            },
            separators=(",", ":"),
        )
    )
    raise SystemExit(0)

print(
    json.dumps(
        {
            "protocolVersion": 1,
            "requestId": meta["requestId"],
            "serverId": meta["serverId"],
            "kind": "status",
            "ok": True,
            "data": status,
        },
        separators=(",", ":"),
    )
)
PY
}

enroll_agent() {
  local url="${PZ_AGENT_URL:-}" token="${AGENT_ENROLLMENT_TOKEN:-}" name display_name
  [ -n "$url" ] || { printf 'pz-agent: PZ_AGENT_URL is required\n' >&2; return 64; }
  [ -n "$token" ] || { printf 'pz-agent: AGENT_ENROLLMENT_TOKEN is required\n' >&2; return 64; }
  name="${PZ_AGENT_NAME:-$(hostname)}"
  display_name="${PZ_AGENT_DISPLAY_NAME:-$PZ_SERVERNAME}"
  url="${url%/}"
  require_secure_url "$url" || return $?

  local payload response
  payload="$(
    AGENT_NAME="$name" \
    AGENT_TOKEN="$token" \
    AGENT_DISPLAY_NAME="$display_name" \
    AGENT_SERVICE="$PZ_SERVICE" \
    AGENT_PORT="$PZ_PORT" \
    AGENT_RUNTIME="$PZ_RUNTIME" \
    AGENT_DATA_DIR="$PZ_CACHEDIR" \
    python3 - <<'PY'
import json
import os

print(
    json.dumps(
        {
            "name": os.environ["AGENT_NAME"],
            "enrollmentToken": os.environ["AGENT_TOKEN"],
            "server": {
                "displayName": os.environ["AGENT_DISPLAY_NAME"],
                "serviceName": os.environ["AGENT_SERVICE"],
                "port": int(os.environ["AGENT_PORT"]),
                "runtime": os.environ["AGENT_RUNTIME"],
                "dataDir": os.environ["AGENT_DATA_DIR"],
            },
        },
        separators=(",", ":"),
    )
)
PY
  )"
  if ! response="$(curl -fsS --max-time 20 -H 'content-type: application/json' --data "$payload" "$url/api/agents/enroll")"; then
    printf 'pz-agent: enrollment request failed\n' >&2
    return 1
  fi
  printf '%s\n' "$response"
}

post_completion() {
  local url="$1" token="$2" body="$3" code attempt
  for attempt in 1 2 3; do
    code="$(printf '%s' "$body" | curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
      -H "authorization: Bearer $token" \
      -H 'content-type: application/json' \
      --data-binary @- "$url" 2>/dev/null || true)"
    case "$code" in
      2??|404) return 0 ;;
      401|403) return 2 ;;
    esac
    [ "$attempt" -lt 3 ] && sleep 2
  done
  return 1
}

agent_state_dir() {
  local relative="${PZ_AGENT_STATE_DIR:-agent-state}"
  case "$relative" in
    ''|.|./|./[./]*|/*|*..*|*[!A-Za-z0-9._/-]*)
      printf 'pz-agent: PZ_AGENT_STATE_DIR must be a safe relative path under PZ_CACHEDIR\n' >&2
      return 64
      ;;
  esac
  printf '%s/%s\n' "$PZ_CACHEDIR" "$relative"
}

dead_letter_completion() {
  local operation_id="$1" body="$2"
  local state_dir tmp
  state_dir="$(agent_state_dir)" || return $?
  case "$operation_id" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  mkdir -p "$state_dir" || return 1
  chmod 700 "$state_dir" || return 1
  umask 077
  tmp="$state_dir/.${operation_id}.tmp.$$"
  if ! printf '%s\n' "$body" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  mv -f "$tmp" "$state_dir/$operation_id.json"
}

retry_dead_letters() {
  local url="$1" agent_id="$2" token="$3"
  local state_dir file operation_id body rc
  state_dir="$(agent_state_dir)" || return $?
  [ -d "$state_dir" ] || return 0
  shopt -s nullglob
  local -a files=("$state_dir"/*.json)
  shopt -u nullglob
  for file in "${files[@]}"; do
    operation_id="${file##*/}"
    operation_id="${operation_id%.json}"
    body="$(cat "$file" 2>/dev/null)" || continue
    if post_completion "$url/api/agents/$agent_id/jobs/$operation_id/complete" "$token" "$body"; then
      rm -f "$file"
    else
      rc=$?
      [ "$rc" -eq 2 ] && return 2
    fi
  done
}

active_job_file() {
  local state_dir
  state_dir="$(agent_state_dir)" || return $?
  printf '%s/active-job\n' "$state_dir"
}

proc_start_time() {
  local pid="$1"
  [ -r "/proc/$pid/stat" ] || return 1
  awk '{print $22}' "/proc/$pid/stat" 2>/dev/null
}

worker_alive() {
  local pid="$1" expected_start state current_start
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pid" -gt 0 ] 2>/dev/null || return 1
  expected_start="$2"
  [ -n "$expected_start" ] || return 1
  current_start="$(proc_start_time "$pid")" || return 1
  [ "$current_start" = "$expected_start" ] || return 1
  state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
  [ "$state" != Z ]
}

reconcile_dead_worker() {
  local url="$1" agent_id="$2" token="$3" operation_id="$4" active_file="$5" body rc
  body='{"status":"failed","error":"host agent worker exited before reporting completion"}'
  if post_completion "$url/api/agents/$agent_id/jobs/$operation_id/complete" "$token" "$body"; then
    rm -f "$active_file"
    return 0
  else
    rc=$?
  fi
  if dead_letter_completion "$operation_id" "$body"; then
    rm -f "$active_file"
    [ "$rc" -eq 2 ] && return 2
    return 0
  fi
  return 1
}

post_progress() {
  local url="$1" agent_id="$2" token="$3" operation_id="$4" message="$5"
  local body
  body="$(MESSAGE="$message" python3 -c 'import json, os; print(json.dumps({"message": os.environ["MESSAGE"]}, separators=(",", ":")))')"
  curl -fsS --max-time 10 -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "$body" "$url/api/agents/$agent_id/jobs/$operation_id/progress" >/dev/null 2>&1
}

post_logs_body() {
  local url="$1" agent_id="$2" token="$3" operation_id="$4" body="$5"
  curl -fsS --max-time 10 -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "$body" "$url/api/agents/$agent_id/jobs/$operation_id/logs" >/dev/null 2>&1
}

post_console_body() {
  local url="$1" agent_id="$2" token="$3" body="$4"
  curl -fsS --max-time 10 -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "$body" "$url/api/agents/$agent_id/console" 2>/dev/null
}

console_state_file() {
  local state_dir
  state_dir="$(agent_state_dir)" || return $?
  printf '%s/console-cursor\n' "$state_dir"
}

console_pending_file() {
  local state_dir
  state_dir="$(agent_state_dir)" || return $?
  printf '%s/console-pending.json\n' "$state_dir"
}

save_console_pending() {
  local file="$1" body="$2" inode="$3" cursor="$4" fingerprint="$5" event_cursor="$6" tmp
  mkdir -p "$(dirname "$file")" || return 1
  chmod 700 "$(dirname "$file")" || return 1
  tmp="$file.tmp.$$"
  umask 077
  BODY="$body" INODE="$inode" CURSOR="$cursor" FINGERPRINT="$fingerprint" EVENT_CURSOR="$event_cursor" python3 - <<'PY' >"$tmp" || return 1
import json
import os

print(json.dumps({
    "body": json.loads(os.environ["BODY"]),
    "inode": os.environ["INODE"],
    "cursor": int(os.environ["CURSOR"]),
    "fingerprint": os.environ["FINGERPRINT"],
    "eventCursor": int(os.environ["EVENT_CURSOR"]),
}, separators=(",", ":")))
PY
  mv -f "$tmp" "$file"
}

initial_console_position() {
  local initial_lines="${PZ_AGENT_CONSOLE_INITIAL_LINES:-200}"
  case "$initial_lines" in ''|*[!0-9]*) return 64 ;; esac
  [ "$initial_lines" -ge 1 ] 2>/dev/null && [ "$initial_lines" -le 500 ] 2>/dev/null || return 64
  LOG_FILE="$PZ_CONSOLE" LOG_BASE="$PZ_CACHEDIR" LOG_INITIAL_LINES="$initial_lines" python3 - <<'PY'
import hashlib
import os

MISSING_RESYNC_ID = hashlib.sha256(b"missing-console-file").hexdigest()
base = os.path.realpath(os.environ["LOG_BASE"])
path = os.path.realpath(os.environ["LOG_FILE"])
if os.path.commonpath((base, path)) != base:
    print(f"0 0 0 1 - {MISSING_RESYNC_ID}")
    raise SystemExit
try:
    stat = os.stat(path)
except OSError:
    print(f"0 0 0 1 - {MISSING_RESYNC_ID}")
    raise SystemExit
start = max(0, stat.st_size - 256 * 1024)
try:
    with open(path, "rb") as handle:
        handle.seek(start)
        raw = handle.read()
except OSError:
    print(f"{stat.st_ino} {stat.st_size} 0 1 - {MISSING_RESYNC_ID}")
    raise SystemExit
if start:
    newline = raw.find(b"\n")
    if newline >= 0:
        start += newline + 1
        raw = raw[newline + 1 :]
lines = raw.splitlines(keepends=True)
keep = int(os.environ["LOG_INITIAL_LINES"])
if len(lines) > keep:
    start += sum(len(line) for line in lines[:-keep])
try:
    with open(path, "rb") as handle:
        handle.seek(max(0, start - 64))
        fingerprint = hashlib.sha256(handle.read(start - max(0, start - 64))).hexdigest()
except OSError:
    fingerprint = "-"
resync_id = hashlib.sha256(f"{stat.st_ino}:{start}:{fingerprint}".encode()).hexdigest()
print(f"{stat.st_ino} {start} 0 1 {fingerprint} {resync_id}")
PY
}

read_console_state() {
  local file="$1" inode cursor event_cursor resync fingerprint resync_id extra
  if [ -r "$file" ] && read -r inode cursor event_cursor resync fingerprint resync_id extra <"$file" &&
    [ -z "${extra:-}" ] && [[ "$inode" =~ ^[0-9]+$ ]] && [[ "$cursor" =~ ^[0-9]+$ ]] &&
    [[ "$event_cursor" =~ ^[0-9]+$ ]] && { [ "$resync" = 0 ] || [ "$resync" = 1 ]; } &&
    { [ "$fingerprint" = - ] || [[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]]; } &&
    { [ "$resync" = 1 ] && [[ "$resync_id" =~ ^[0-9a-f]{64}$ ]] || [ "$resync" = 0 ] && [ "$resync_id" = - ]; }; then
    printf '%s %s %s %s %s %s\n' "$inode" "$cursor" "$event_cursor" "$resync" "$fingerprint" "$resync_id"
    return 0
  fi
  initial_console_position
}

save_console_state() {
  local file="$1" inode="$2" cursor="$3" event_cursor="$4" resync="$5" fingerprint="$6" resync_id="$7" tmp
  mkdir -p "$(dirname "$file")" || return 1
  chmod 700 "$(dirname "$file")" || return 1
  tmp="$file.tmp.$$"
  umask 077
  printf '%s %s %s %s %s %s\n' "$inode" "$cursor" "$event_cursor" "$resync" "$fingerprint" "$resync_id" >"$tmp" || return 1
  mv -f "$tmp" "$file"
}

read_console_position() {
  LOG_FILE="$PZ_CONSOLE" LOG_BASE="$PZ_CACHEDIR" python3 - <<'PY'
import os

base = os.path.realpath(os.environ["LOG_BASE"])
path = os.path.realpath(os.environ["LOG_FILE"])
if os.path.commonpath((base, path)) != base:
    print("0 0")
    raise SystemExit
try:
    stat = os.stat(path)
    print(f"{stat.st_ino} {stat.st_size}")
except OSError:
    print("0 0")
PY
}

read_console_delta() {
  local cursor="$1" inode="$2" flush="$3" fingerprint="${4:-}"
  LOG_FILE="$PZ_CONSOLE" LOG_BASE="$PZ_CACHEDIR" LOG_CURSOR="$cursor" LOG_INODE="$inode" LOG_FLUSH="$flush" LOG_FINGERPRINT="$fingerprint" python3 - <<'PY'
import hashlib
import json
import os

MAX_BYTES = 64 * 1024
MAX_LINES = 100
MAX_LINE = 2048
MAX_JSON_BYTES = 60 * 1024
path = os.environ["LOG_FILE"]
base = os.path.realpath(os.environ["LOG_BASE"])
path = os.path.realpath(path)
if os.path.commonpath((base, path)) != base:
    print(json.dumps({"inode": 0, "cursor": 0, "fingerprint": "-", "lines": []}, separators=(",", ":")))
    raise SystemExit
try:
    stat = os.stat(path)
except OSError:
    print(json.dumps({"inode": 0, "cursor": 0, "fingerprint": "-", "lines": []}, separators=(",", ":")))
    raise SystemExit
try:
    with open(path, "rb") as handle:
        source_fingerprint = hashlib.sha256(handle.read(64)).hexdigest()
except OSError:
    source_fingerprint = "-"

inode = str(stat.st_ino)
offset = int(os.environ.get("LOG_CURSOR", "0"))
saved_fingerprint = os.environ.get("LOG_FINGERPRINT", "")
reset = False
if os.environ.get("LOG_INODE", "") != inode or offset > stat.st_size:
    offset = 0
    reset = True

try:
    with open(path, "rb") as handle:
        if offset and saved_fingerprint and saved_fingerprint != "-":
            handle.seek(max(0, offset - 64))
            current_fingerprint = hashlib.sha256(handle.read(offset - max(0, offset - 64))).hexdigest()
            if current_fingerprint != saved_fingerprint:
                # A same-inode truncate/rewrite can refill beyond the prior byte offset.
                offset = 0
                reset = True
        handle.seek(offset)
        raw = handle.read(MAX_BYTES)
except OSError:
    print(json.dumps({"inode": inode, "cursor": offset, "fingerprint": "-", "sourceFingerprint": source_fingerprint, "reset": reset, "lines": []}, separators=(",", ":")))
    raise SystemExit

if not raw:
    try:
        with open(path, "rb") as handle:
            handle.seek(max(0, offset - 64))
            fingerprint = hashlib.sha256(handle.read(offset - max(0, offset - 64))).hexdigest()
    except OSError:
        fingerprint = "-"
    print(json.dumps({"inode": inode, "cursor": offset, "fingerprint": fingerprint, "sourceFingerprint": source_fingerprint, "reset": reset, "lines": []}, separators=(",", ":")))
    raise SystemExit

flush = os.environ.get("LOG_FLUSH") == "1"
last_newline = raw.rfind(b"\n")
if flush:
    complete_end = len(raw)
elif last_newline >= 0:
    complete_end = last_newline + 1
elif len(raw) >= MAX_BYTES:
    # A pathological line must not prevent the cursor from advancing forever.
    complete_end = len(raw)
else:
    complete_end = 0

pieces = raw[:complete_end].splitlines(keepends=True)
selected = []
encoded_bytes = 2
for piece in pieces:
    if len(selected) >= MAX_LINES:
        break
    line = piece.rstrip(b"\r\n").decode("utf-8", "replace")[:MAX_LINE]
    candidate_bytes = len(json.dumps(line).encode("utf-8")) + (1 if selected else 0)
    if selected and encoded_bytes + candidate_bytes > MAX_JSON_BYTES:
        break
    selected.append((piece, line))
    encoded_bytes += candidate_bytes
consumed = sum(len(piece) for piece, _ in selected)
lines = [line for _, line in selected]
next_offset = offset + consumed
try:
    with open(path, "rb") as handle:
        handle.seek(max(0, next_offset - 64))
        fingerprint = hashlib.sha256(handle.read(next_offset - max(0, next_offset - 64))).hexdigest()
except OSError:
    fingerprint = "-"
print(json.dumps({"inode": inode, "cursor": next_offset, "fingerprint": fingerprint, "sourceFingerprint": source_fingerprint, "reset": reset, "lines": lines}, separators=(",", ":")))
PY
}

send_operation_console_delta() {
  local url="$1" agent_id="$2" token="$3" operation_id="$4"
  local file_cursor="$5" inode="$6" event_cursor="$7" flush="$8"
  local delta lines_json next_file_cursor next_inode line_count next_event_cursor body
  delta="$(read_console_delta "$file_cursor" "$inode" "$flush")" || return 1
  next_file_cursor="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["cursor"])')"
  next_inode="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["inode"])')"
  lines_json="$(DELTA="$delta" python3 -c 'import json, os; print(json.dumps(json.loads(os.environ["DELTA"])["lines"], separators=(",", ":")))')"
  line_count="$(LINES="$lines_json" python3 -c 'import json, os; print(len(json.loads(os.environ["LINES"])))')"
  next_event_cursor=$((event_cursor + line_count))
  if [ "$lines_json" != "[]" ]; then
    body="$(CURSOR="$next_event_cursor" LINES="$lines_json" python3 - <<'PY'
import json
import os

print(json.dumps({"cursor": int(os.environ["CURSOR"]), "lines": json.loads(os.environ["LINES"])}, separators=(",", ":")))
PY
    )"
    post_logs_body "$url" "$agent_id" "$token" "$operation_id" "$body" || return 1
  fi
  LOG_NEXT_CURSOR="$next_file_cursor"
  LOG_NEXT_INODE="$next_inode"
  LOG_NEXT_EVENT_CURSOR="$next_event_cursor"
}

send_live_console_delta() {
  local url="$1" agent_id="$2" token="$3" file_cursor="$4" inode="$5" event_cursor="$6" resync="$7" fingerprint="$8" resync_id="$9" flush="${10}"
  local delta lines_json next_file_cursor next_inode next_fingerprint source_fingerprint line_count next_event_cursor body response accepted_cursor pending_file
  local pending_body pending_inode pending_cursor pending_fingerprint pending_event_cursor pending_delta pending_current_inode pending_reset
  local -a pending_fields=()
  pending_file="$(console_pending_file)" || return $?
  if [ -r "$pending_file" ]; then
    mapfile -t pending_fields < <(PENDING="$(cat "$pending_file")" python3 - <<'PY'
import json
import os

pending = json.loads(os.environ["PENDING"])
print(json.dumps(pending["body"], separators=(",", ":")))
print(pending["inode"])
print(pending["cursor"])
print(pending["fingerprint"])
print(pending["eventCursor"])
PY
    ) || return 1
    pending_body="${pending_fields[0]:-}"
    pending_inode="${pending_fields[1]:-}"
    pending_cursor="${pending_fields[2]:-}"
    pending_fingerprint="${pending_fields[3]:-}"
    pending_event_cursor="${pending_fields[4]:-}"
    [ -n "$pending_body" ] || return 1
    pending_delta="$(read_console_delta "$pending_cursor" "$pending_inode" 0 "$pending_fingerprint")" || return 1
    pending_current_inode="$(DELTA="$pending_delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["inode"])')"
    pending_reset="$(DELTA="$pending_delta" python3 -c 'import json, os; print(int(bool(json.loads(os.environ["DELTA"]).get("reset", False))))')"
    if [ "$pending_current_inode" != "$pending_inode" ] || [ "$pending_reset" = 1 ]; then
      # Do not acknowledge output from an old generation after a truncate/rotation. The persisted
      # state remains a rebase, so the normal path below creates a new bounded request.
      rm -f "$pending_file"
    else
      response="$(post_console_body "$url" "$agent_id" "$token" "$pending_body")" || return 1
      accepted_cursor="$(RESPONSE="$response" python3 - <<'PY'
import json
import os

value = json.loads(os.environ["RESPONSE"]).get("cursor")
if not isinstance(value, int) or value < 0:
    raise SystemExit(1)
print(value)
PY
      )" || return 1
      [ "$accepted_cursor" -ge "$pending_event_cursor" ] || return 1
      rm -f "$pending_file"
      LOG_NEXT_CURSOR="$pending_cursor"
      LOG_NEXT_INODE="$pending_inode"
      LOG_NEXT_EVENT_CURSOR="$accepted_cursor"
      LOG_NEXT_RESYNC=0
      LOG_NEXT_FINGERPRINT="$pending_fingerprint"
      LOG_NEXT_RESYNC_ID="-"
      return 0
    fi
  fi
  delta="$(read_console_delta "$file_cursor" "$inode" "$flush" "$fingerprint")" || return 1
  next_file_cursor="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["cursor"])')"
  next_inode="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["inode"])')"
  next_fingerprint="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"])["fingerprint"])')"
  source_fingerprint="$(DELTA="$delta" python3 -c 'import json, os; print(json.loads(os.environ["DELTA"]).get("sourceFingerprint", "-"))')"
  lines_json="$(DELTA="$delta" python3 -c 'import json, os; print(json.dumps(json.loads(os.environ["DELTA"])["lines"], separators=(",", ":")))')"
  line_count="$(LINES="$lines_json" python3 -c 'import json, os; print(len(json.loads(os.environ["LINES"])))')"
  next_event_cursor=$((event_cursor + line_count))
  if [ "$lines_json" != "[]" ]; then
    if [ "$resync" = 1 ]; then
      resync_id="$(INODE="$next_inode" START="$file_cursor" END="$next_file_cursor" SOURCE="$source_fingerprint" LINES="$lines_json" python3 - <<'PY'
import hashlib
import os
print(hashlib.sha256("\\0".join([os.environ["INODE"], os.environ["START"], os.environ["END"], os.environ["SOURCE"], os.environ["LINES"]]).encode()).hexdigest())
PY
      )"
    fi
    body="$(SERVER_ID="$PZ_SERVER_ID" CURSOR="$next_event_cursor" RESYNC="$resync" RESYNC_ID="$resync_id" LINES="$lines_json" python3 - <<'PY'
import json
import os

body = {"serverId": os.environ["SERVER_ID"], "cursor": int(os.environ["CURSOR"]), "resync": os.environ["RESYNC"] == "1", "lines": json.loads(os.environ["LINES"])}
if body["resync"]:
    body["resyncId"] = os.environ["RESYNC_ID"]
print(json.dumps(body, separators=(",", ":")))
PY
    )"
    if [ "$resync" = 1 ]; then
      save_console_pending "$pending_file" "$body" "$next_inode" "$next_file_cursor" \
        "$next_fingerprint" "$next_event_cursor" || return 1
    fi
    response="$(post_console_body "$url" "$agent_id" "$token" "$body")" || return 1
    accepted_cursor="$(RESPONSE="$response" python3 - <<'PY'
import json
import os

value = json.loads(os.environ["RESPONSE"]).get("cursor")
if not isinstance(value, int) or value < 0:
    raise SystemExit(1)
print(value)
PY
    )" || return 1
    # An agent restart can restore an older local state after the API already accepted a batch.
    # A higher API cursor explicitly resynchronizes it without replaying the whole console.
    [ "$accepted_cursor" -ge "$next_event_cursor" ] || return 1
    next_event_cursor="$accepted_cursor"
    resync=0
    resync_id="-"
    rm -f "$pending_file"
  fi
  LOG_NEXT_CURSOR="$next_file_cursor"
  LOG_NEXT_INODE="$next_inode"
  LOG_NEXT_EVENT_CURSOR="$next_event_cursor"
  LOG_NEXT_RESYNC="$resync"
  LOG_NEXT_FINGERPRINT="$next_fingerprint"
  LOG_NEXT_RESYNC_ID="$resync_id"
}

run_long_job() {
  local url="$1" agent_id="$2" token="$3" operation_id="$4" kind="$5" active_file="$6"
  local state_dir result_file host_kind
  state_dir="$(agent_state_dir)" || return $?
  case "$operation_id" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  mkdir -p "$state_dir" || return 1
  result_file="$state_dir/.${operation_id}.result.$$"
  host_kind="$kind"
  [ "$kind" = "build.update" ] && host_kind=build-update
  (
    local result completion command_pid command_rc worker_pid worker_start
    local log_inode log_file_cursor log_event_cursor log_flush=0 final_attempts progress_message
    progress_message="Host operation is still running."
    [ "$kind" = "build.update" ] &&
      progress_message="Saving the world, creating a backup, and downloading the configured game build."
    worker_pid="$BASHPID"
    worker_start="$(proc_start_time "$worker_pid")"
    if [ -z "$worker_start" ]; then
      completion='{"status":"failed","error":"host agent worker could not be identified"}'
      post_completion "$url/api/agents/$agent_id/jobs/$operation_id/complete" "$token" "$completion" ||
        dead_letter_completion "$operation_id" "$completion" || true
      exit 1
    fi
    if ! printf '%s %s %s\n' "$operation_id" "$worker_pid" "$worker_start" >"$active_file.tmp.$$" ||
      ! mv -f "$active_file.tmp.$$" "$active_file"; then
      rm -f "$active_file.tmp.$$"
      completion='{"status":"failed","error":"host agent could not persist its worker lease"}'
      post_completion "$url/api/agents/$agent_id/jobs/$operation_id/complete" "$token" "$completion" ||
        dead_letter_completion "$operation_id" "$completion" || true
      exit 1
    fi
    read -r log_inode log_file_cursor < <(read_console_position)
    log_event_cursor=0
    : >"$result_file" || exit 1

    sudo -n "$PZ_AGENT_PRIV" "$host_kind" >"$result_file" 2>&1 &
    command_pid=$!
    while kill -0 "$command_pid" 2>/dev/null; do
      post_progress "$url" "$agent_id" "$token" "$operation_id" "$progress_message" || true
      if send_operation_console_delta "$url" "$agent_id" "$token" "$operation_id" "$log_file_cursor" "$log_inode" "$log_event_cursor" "$log_flush"; then
        log_file_cursor="$LOG_NEXT_CURSOR"
        log_event_cursor="$LOG_NEXT_EVENT_CURSOR"
        log_inode="$LOG_NEXT_INODE"
      fi
      sleep 2
    done
    wait "$command_pid"
    command_rc="$?"

    # Retry the final flush so a transient API/network failure does not drop the tail.
    log_flush=1
    final_attempts=0
    while [ "$final_attempts" -lt 5 ]; do
      if send_operation_console_delta "$url" "$agent_id" "$token" "$operation_id" "$log_file_cursor" "$log_inode" "$log_event_cursor" "$log_flush"; then
        log_file_cursor="$LOG_NEXT_CURSOR"
        log_event_cursor="$LOG_NEXT_EVENT_CURSOR"
        log_inode="$LOG_NEXT_INODE"
        break
      fi
      final_attempts=$((final_attempts + 1))
      [ "$final_attempts" -ge 5 ] || sleep 1
    done

    result="$(cat "$result_file" 2>/dev/null || true)"
    if [ "$command_rc" -eq 0 ] && completion="$(RESULT="$result" KIND="$kind" python3 - <<'PY'
import json
import os

value = json.loads(os.environ["RESULT"])
if os.environ["KIND"] == "build.update" and value.get("status") in {"blocked", "unavailable", "failed"}:
    print(json.dumps({
        "status": "failed",
        "error": value.get("message") or "Host build update failed",
        "result": value,
    }, separators=(",", ":")))
else:
    print(json.dumps({"status": "succeeded", "result": value}, separators=(",", ":")))
PY
    )"; then
      :
    else
      completion="$(KIND="$kind" RC="$command_rc" python3 - <<'PY'
import json
import os

print(json.dumps({"status": "failed", "error": f"host operation {os.environ['KIND']} failed (exit {os.environ['RC']})"}, separators=(",", ":")))
PY
      )"
    fi
    post_completion "$url/api/agents/$agent_id/jobs/$operation_id/complete" "$token" "$completion" ||
      dead_letter_completion "$operation_id" "$completion" || true
    rm -f "$result_file" "$active_file" "$active_file.tmp.$$"
  ) &
}

poll_agent() {
  local url="${PZ_AGENT_URL:-}" agent_id="${PZ_AGENT_ID:-}" access_token="${PZ_AGENT_ACCESS_TOKEN:-}"
  local interval="${PZ_AGENT_INTERVAL:-15}" status payload completion_rc fallback_completion dead_letter_rc
  local pending_job_id="" pending_completion="" pending_completion_attempts=0
  local pending_completion_retry_limit="${PZ_AGENT_PENDING_COMPLETION_RETRIES:-3}"
  [ -n "$url" ] || { printf 'pz-agent: PZ_AGENT_URL is required\n' >&2; return 64; }
  [ -n "$agent_id" ] || { printf 'pz-agent: PZ_AGENT_ID is required\n' >&2; return 64; }
  [ -n "$access_token" ] || { printf 'pz-agent: PZ_AGENT_ACCESS_TOKEN is required\n' >&2; return 64; }
  case "$interval" in ''|*[!0-9]*) printf 'pz-agent: PZ_AGENT_INTERVAL must be an integer\n' >&2; return 64 ;; esac
  [ "$interval" -ge 5 ] 2>/dev/null || { printf 'pz-agent: PZ_AGENT_INTERVAL must be at least 5 seconds\n' >&2; return 64; }
  case "$pending_completion_retry_limit" in ''|*[!0-9]*) printf 'pz-agent: PZ_AGENT_PENDING_COMPLETION_RETRIES must be an integer\n' >&2; return 64 ;; esac
  [ "$pending_completion_retry_limit" -ge 1 ] 2>/dev/null || {
    printf 'pz-agent: PZ_AGENT_PENDING_COMPLETION_RETRIES must be at least 1\n' >&2
    return 64
  }
  local active_file active_id active_pid active_start dead_worker_rc
  local console_state console_inode console_file_cursor console_event_cursor console_resync console_fingerprint console_resync_id
  agent_state_dir >/dev/null || return $?
  active_file="$(active_job_file)" || return $?
  mkdir -p "$(dirname "$active_file")" || return 1
  console_state="$(console_state_file)" || return $?
  read -r console_inode console_file_cursor console_event_cursor console_resync console_fingerprint console_resync_id < <(
    read_console_state "$console_state"
  ) || return 1
  url="${url%/}"
  require_secure_url "$url" || return $?

  while :; do
    retry_dead_letters "$url" "$agent_id" "$access_token"
    dead_letter_rc=$?
    [ "$dead_letter_rc" -eq 2 ] && {
      printf 'pz-agent: agent authorization failed while replaying dead letters\n' >&2
      return 1
    }
    if [ -n "$pending_job_id" ]; then
      pending_completion_attempts=$((pending_completion_attempts + 1))
      if post_completion "$url/api/agents/$agent_id/jobs/$pending_job_id/complete" "$access_token" "$pending_completion"; then
        pending_job_id=""
        pending_completion=""
        pending_completion_attempts=0
      else
        completion_rc=$?
        [ "$completion_rc" -eq 2 ] && {
          printf 'pz-agent: agent authorization failed; stopping for re-enrollment\n' >&2
          return 1
        }
        fallback_completion='{"status":"failed","error":"control plane rejected the operation result"}'
        if post_completion "$url/api/agents/$agent_id/jobs/$pending_job_id/complete" "$access_token" "$fallback_completion"; then
          pending_job_id=""
          pending_completion=""
          pending_completion_attempts=0
        else
          completion_rc=$?
          [ "$completion_rc" -eq 2 ] && return 1
          if [ "$pending_completion_attempts" -ge "$pending_completion_retry_limit" ]; then
            if dead_letter_completion "$pending_job_id" "$pending_completion"; then
              printf 'pz-agent: pending completion dead-lettered after %s attempts; continuing\n' \
                "$pending_completion_attempts" >&2
              pending_job_id=""
              pending_completion=""
              pending_completion_attempts=0
            else
              printf 'pz-agent: could not persist pending completion; retaining retry\n' >&2
              pending_completion_attempts=0
            fi
          else
            printf 'pz-agent: pending completion rejected; retaining retry (%s/%s)\n' \
              "$pending_completion_attempts" "$pending_completion_retry_limit" >&2
          fi
        fi
      fi
    fi

    if [ -f "$active_file" ]; then
      read -r active_id active_pid active_start <"$active_file" || {
        rm -f "$active_file"
        active_id=""
        active_pid=""
        active_start=""
      }
      case "${active_id:-}" in
        ''|*[!A-Za-z0-9._-]*)
          rm -f "$active_file"
          active_id=""
          ;;
      esac
      if [ -n "${active_id:-}" ] && worker_alive "${active_pid:-}" "${active_start:-}"; then
        post_progress "$url" "$agent_id" "$access_token" "$active_id" "Host operation is still running." || true
      elif [ -n "${active_id:-}" ]; then
        if reconcile_dead_worker "$url" "$agent_id" "$access_token" "$active_id" "$active_file"; then
          :
        else
          dead_worker_rc=$?
          [ "$dead_worker_rc" -eq 2 ] && return 1
          printf 'pz-agent: could not reconcile dead worker %s; retrying\n' "$active_id" >&2
        fi
      fi
    fi

    if status="$(agent_status_json 2>/dev/null)"; then
      payload="$(STATUS="$status" python3 - <<'PY'
import json
import os

print(json.dumps({"status": json.loads(os.environ["STATUS"])}, separators=(",", ":")))
PY
      )"
      if ! curl -fsS --max-time 20 \
        -H "authorization: Bearer $access_token" \
        -H 'content-type: application/json' \
        --data "$payload" \
        "$url/api/agents/$agent_id/heartbeat" >/dev/null; then
        printf 'pz-agent: heartbeat failed; retrying\n' >&2
      fi

      if send_live_console_delta "$url" "$agent_id" "$access_token" \
        "$console_file_cursor" "$console_inode" "$console_event_cursor" "$console_resync" \
        "$console_fingerprint" "$console_resync_id" 0; then
        console_file_cursor="$LOG_NEXT_CURSOR"
        console_inode="$LOG_NEXT_INODE"
        console_event_cursor="$LOG_NEXT_EVENT_CURSOR"
        console_resync="$LOG_NEXT_RESYNC"
        console_fingerprint="$LOG_NEXT_FINGERPRINT"
        console_resync_id="$LOG_NEXT_RESYNC_ID"
        save_console_state "$console_state" "$console_inode" "$console_file_cursor" \
          "$console_event_cursor" "$console_resync" "$console_fingerprint" "$console_resync_id" ||
          printf 'pz-agent: could not persist console cursor; retrying from the prior cursor\n' >&2
      else
        printf 'pz-agent: console publish failed; retrying\n' >&2
      fi

      local job_response job_id job_kind job_payload completion result_status lines workshop_id keep log_publish_rc
      local -a job_fields=()
      if [ -z "$pending_job_id" ] && [ ! -f "$active_file" ] && job_response="$(curl -fsS --max-time 20 -X POST \
        -H "authorization: Bearer $access_token" \
        "$url/api/agents/$agent_id/jobs/claim" 2>/dev/null)"; then
        mapfile -t job_fields < <(JOB="$job_response" python3 - <<'PY'
import json
import os

job = json.loads(os.environ["JOB"]).get("job")
request = (job or {}).get("request") or {}
print(job.get("operationId", "") if job else "")
print(request.get("kind", ""))
print(json.dumps(request.get("payload", {}), separators=(",", ":")))
PY
        )
        job_id="${job_fields[0]:-}"
        job_kind="${job_fields[1]:-}"
        job_payload="${job_fields[2]:-}"
        [ -n "$job_payload" ] || job_payload='{}'
        if [ -n "$job_id" ]; then
          case "$job_kind" in
            status)
              if result_status="$(agent_status_json 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            start|stop|restart)
              if ! run_long_job "$url" "$agent_id" "$access_token" "$job_id" "$job_kind" "$active_file"; then
                completion='{"status":"failed","error":"host agent could not start the background worker"}'
                if post_completion "$url/api/agents/$agent_id/jobs/$job_id/complete" "$access_token" "$completion"; then
                  :
                else
                  dead_letter_completion "$job_id" "$completion" || true
                fi
              fi
              sleep "$interval"
              continue
              ;;
            build.update)
              if ! run_long_job "$url" "$agent_id" "$access_token" "$job_id" "$job_kind" "$active_file"; then
                completion='{"status":"failed","error":"host agent could not start the background worker"}'
                if post_completion "$url/api/agents/$agent_id/jobs/$job_id/complete" "$access_token" "$completion"; then
                  :
                else
                  dead_letter_completion "$job_id" "$completion" || true
                fi
              fi
              sleep "$interval"
              continue
              ;;
            backup)
              keep="$(PAYLOAD="$job_payload" python3 - <<'PY'
import json
import os
print(json.loads(os.environ["PAYLOAD"]).get("keep", ""))
PY
              )"
              if [ -n "$keep" ]; then
                if result_status="$(sudo -n "$PZ_AGENT_PRIV" backup "$keep" 2>/dev/null)"; then :; else result_status=""; fi
              elif result_status="$(sudo -n "$PZ_AGENT_PRIV" backup 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.list)
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" mods-list 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.add)
              workshop_id="$(PAYLOAD="$job_payload" python3 - <<'PY'
import json
import os
print(json.loads(os.environ["PAYLOAD"]).get("workshopId", ""))
PY
              )"
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" mods-add "$workshop_id" 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.remove)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" mods-remove 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.configure)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" mods-configure 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.update.check)
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" mods-update-check 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            mods.update.apply)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" mods-update-apply 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            settings.update)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" settings 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            settings.read)
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" settings-read 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            config.read)
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" config-read 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            config.update)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" config-update 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            world.reset)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" world-reset 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            *)
              result_status=""
              ;;
          esac

          if [ -n "$result_status" ]; then
            if [ "$job_kind" = "mods.update.apply" ] || [ "$job_kind" = "build.update" ]; then
              if completion="$(printf '%s' "$result_status" | python3 -c '
import json
import sys

try:
    result = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)
if result.get("status") in {"blocked", "unavailable", "failed"}:
    print(json.dumps({"status": "failed", "error": result.get("message") or "Host update failed"}, separators=(",", ":")))
else:
    print(json.dumps({"status": "succeeded", "result": result}, separators=(",", ":")))
')"; then
                :
              else
                completion='{"status":"failed","error":"agent returned invalid JSON result"}'
              fi
            elif completion="$(printf '%s' "$result_status" | python3 -c '
import json
import sys

try:
    result = json.load(sys.stdin)
except json.JSONDecodeError:
    raise SystemExit(1)
print(json.dumps({"status": "succeeded", "result": result}, separators=(",", ":")))
')"; then
              :
            else
              completion='{"status":"failed","error":"agent returned invalid JSON result"}'
            fi
          else
            completion="$(KIND="$job_kind" python3 - <<'PY'
import json
import os

print(json.dumps({"status": "failed", "error": f"unsupported or failed operation: {os.environ['KIND']}"}, separators=(",", ":")))
PY
            )"
          fi
          if post_completion "$url/api/agents/$agent_id/jobs/$job_id/complete" "$access_token" "$completion"; then
            :
          else
            completion_rc=$?
            [ "$completion_rc" -eq 2 ] && {
              printf 'pz-agent: agent authorization failed; stopping for re-enrollment\n' >&2
              return 1
            }
            pending_job_id="$job_id"
            pending_completion="$completion"
            pending_completion_attempts=0
            printf 'pz-agent: job completion failed; retaining for retry\n' >&2
          fi
        fi
      else
        [ -n "$pending_job_id" ] || printf 'pz-agent: job claim failed; retrying\n' >&2
      fi
    else
      printf 'pz-agent: local status failed; retrying\n' >&2
    fi
    sleep "$interval"
  done
}

if [ "${PZ_AGENT_SOURCE_ONLY:-0}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi

case "${1:-}" in
  --status)
    [ "$#" -eq 1 ] || { printf 'pz-agent: --status takes no arguments\n' >&2; exit 64; }
    agent_status_json
    ;;
  --stdio)
    [ "$#" -eq 1 ] || { printf 'pz-agent: --stdio takes no arguments\n' >&2; exit 64; }
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      respond_status "$line"
    done
    ;;
  --enroll)
    [ "$#" -eq 1 ] || { printf 'pz-agent: --enroll takes no arguments\n' >&2; exit 64; }
    enroll_agent
    ;;
  --poll)
    [ "$#" -eq 1 ] || { printf 'pz-agent: --poll takes no arguments\n' >&2; exit 64; }
    poll_agent
    ;;
  --help|-h)
    agent_help
    ;;
  *)
    agent_help >&2
    exit 64
    ;;
esac
