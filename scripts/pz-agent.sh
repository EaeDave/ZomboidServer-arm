#!/usr/bin/env bash
#
# pz-agent — narrow stdio boundary for the host control plane.
#
# This first implementation supports status heartbeats and a local stdio protocol only. The
# outbound --poll mode never opens a listening port on the VPS. Mutating operations stay disabled
# until their pzctl core functions and audit semantics are tested.
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

agent_help() {
  cat <<'EOF'
Usage: pz-agent [--status | --stdio | --enroll | --poll | --help]

--status  emit the local pzctl status JSON and exit
--stdio   read one versioned status request JSON object per line and emit one response per line
--enroll  exchange AGENT_ENROLLMENT_TOKEN for a one-time access token (prints JSON)
--poll    send authenticated status heartbeats to PZ_AGENT_URL until stopped
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

respond_status() {
  local line="$1" metadata status
  if ! metadata="$(validate_request "$line")"; then
    printf '%s\n' "$metadata"
    return 0
  fi

  if ! status="$("$PZCTL_BIN" status --json 2>/dev/null)"; then
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

poll_agent() {
  local url="${PZ_AGENT_URL:-}" agent_id="${PZ_AGENT_ID:-}" access_token="${PZ_AGENT_ACCESS_TOKEN:-}"
  local interval="${PZ_AGENT_INTERVAL:-15}" status payload
  [ -n "$url" ] || { printf 'pz-agent: PZ_AGENT_URL is required\n' >&2; return 64; }
  [ -n "$agent_id" ] || { printf 'pz-agent: PZ_AGENT_ID is required\n' >&2; return 64; }
  [ -n "$access_token" ] || { printf 'pz-agent: PZ_AGENT_ACCESS_TOKEN is required\n' >&2; return 64; }
  case "$interval" in ''|*[!0-9]*) printf 'pz-agent: PZ_AGENT_INTERVAL must be an integer\n' >&2; return 64 ;; esac
  [ "$interval" -ge 5 ] 2>/dev/null || { printf 'pz-agent: PZ_AGENT_INTERVAL must be at least 5 seconds\n' >&2; return 64; }
  url="${url%/}"

  while :; do
    if status="$("$PZCTL_BIN" status --json 2>/dev/null)"; then
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

      local job_response job_id job_kind job_payload completion result_status lines workshop_id
      if job_response="$(curl -fsS --max-time 20 -X POST \
        -H "authorization: Bearer $access_token" \
        "$url/api/agents/$agent_id/jobs/claim" 2>/dev/null)"; then
        job_id="$(JOB="$job_response" python3 - <<'PY'
import json
import os

job = json.loads(os.environ["JOB"]).get("job")
print(job["operationId"] if job else "")
PY
        )"
        job_kind="$(JOB="$job_response" python3 - <<'PY'
import json
import os

job = json.loads(os.environ["JOB"]).get("job")
print(job["request"]["kind"] if job else "")
PY
        )"
        job_payload="$(JOB="$job_response" python3 - <<'PY'
import json
import os

job = json.loads(os.environ["JOB"]).get("job")
print(json.dumps(job["request"]["payload"] if job else {}, separators=(",", ":")))
PY
        )"
        if [ -n "$job_id" ]; then
          case "$job_kind" in
            status)
              if result_status="$("$PZCTL_BIN" status --json 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            start|stop|restart|backup)
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" "$job_kind" 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            logs)
              lines="$(PAYLOAD="$job_payload" python3 - <<'PY'
import json
import os

print(json.loads(os.environ["PAYLOAD"]).get("lines", 50))
PY
              )"
              if result_status="$(sudo -n "$PZ_AGENT_PRIV" logs "$lines" 2>/dev/null)"; then :; else result_status=""; fi
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
            settings.update)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" settings 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            world.reset)
              if result_status="$(printf '%s' "$job_payload" | sudo -n "$PZ_AGENT_PRIV" world-reset 2>/dev/null)"; then :; else result_status=""; fi
              ;;
            *)
              result_status=""
              ;;
          esac

          if [ -n "$result_status" ]; then
            completion="$(RESULT="$result_status" python3 - <<'PY'
import json
import os

print(json.dumps({"status": "succeeded", "result": json.loads(os.environ["RESULT"])}, separators=(",", ":")))
PY
            )"
          else
            completion="$(KIND="$job_kind" python3 - <<'PY'
import json
import os

print(json.dumps({"status": "failed", "error": f"unsupported or failed operation: {os.environ['KIND']}"}, separators=(",", ":")))
PY
            )"
          fi
          if ! curl -fsS --max-time 20 \
            -H "authorization: Bearer $access_token" \
            -H 'content-type: application/json' \
            --data "$completion" \
            "$url/api/agents/$agent_id/jobs/$job_id/complete" >/dev/null; then
            printf 'pz-agent: job completion failed; retrying\n' >&2
          fi
        fi
      else
        printf 'pz-agent: job claim failed; retrying\n' >&2
      fi
    else
      printf 'pz-agent: local status failed; retrying\n' >&2
    fi
    sleep "$interval"
  done
}

case "${1:-}" in
  --status)
    [ "$#" -eq 1 ] || { printf 'pz-agent: --status takes no arguments\n' >&2; exit 64; }
    exec "$PZCTL_BIN" status --json
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
