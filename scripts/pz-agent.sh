#!/usr/bin/env bash
#
# pz-agent — narrow stdio boundary for the host control plane.
#
# This first implementation intentionally supports status only. It is not a network listener;
# an authenticated transport may invoke --stdio later. Mutating operations stay disabled until
# their pzctl core functions and audit semantics are tested.
set -uo pipefail

PZCTL_BIN="${PZCTL_BIN:-/usr/local/bin/pzctl}"
PZ_COMMON="${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}"

[ -r "$PZ_COMMON" ] || {
  printf 'pz-agent: common library not found: %s\n' "$PZ_COMMON" >&2
  exit 1
}
. "$PZ_COMMON"
pz_load_env

agent_help() {
  cat <<'EOF'
Usage: pz-agent [--status | --stdio | --help]

--status  emit the local pzctl status JSON and exit
--stdio   read one versioned status request JSON object per line and emit one response per line
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
  --help|-h)
    agent_help
    ;;
  *)
    agent_help >&2
    exit 64
    ;;
esac
