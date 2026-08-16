#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

CONSOLE="$TMP_DIR/server-console.txt"
EVENTS="$TMP_DIR/events.jsonl"
: >"$EVENTS"
PORT_FILE="$TMP_DIR/port"
COMMON="$TMP_DIR/common.sh"
mkdir -p "$TMP_DIR/bin"
cat >"$COMMON" <<'EOF'
pz_load_env() {
  PZ_SERVER_ID=worker-test
  PZ_SERVICE=worker-test
  PZ_CONSOLE="$TEST_CONSOLE"
  PZ_CACHEDIR="$TEST_ROOT"
  PZ_SERVERNAME=servertest
  PZ_STEAM_SESSION_CHECK=observe
  PZ_STEAM_SESSION_STATUS="$TEST_ROOT/steam.json"
  export PZ_SERVER_ID PZ_SERVICE PZ_CONSOLE PZ_CACHEDIR PZ_SERVERNAME PZ_STEAM_SESSION_CHECK PZ_STEAM_SESSION_STATUS
}
EOF
cat >"$TMP_DIR/bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
[ "${1:-}" = -n ] && shift
shift # fixed pz-agent-priv path; the test fake owns the command behavior
case "${1:-}" in
  status)
    printf '%s\n' '{"protocolVersion":1,"serverId":"worker-test","serviceName":"worker-test","state":"active","substate":"running","listening":true,"runtime":"fex","gameVersion":"42.20.2","uptimeSeconds":10,"playerCount":0,"checkedAt":"2026-08-16T00:00:00Z"}'
    ;;
  start)
    printf 'booting\n' >>"$TEST_CONSOLE"
    sleep 6
    printf 'ready\n' >>"$TEST_CONSOLE"
    printf '%s\n' '{"protocolVersion":1,"serverId":"worker-test","serviceName":"worker-test","state":"active","substate":"running","listening":true,"runtime":"fex","gameVersion":"42.20.2","uptimeSeconds":16,"playerCount":0,"checkedAt":"2026-08-16T00:00:16Z"}'
    ;;
  *) exit 64 ;;
esac
EOF
cat >"$TMP_DIR/bin/pzctl" <<'EOF'
#!/usr/bin/env bash
exec "$TEST_FAKE_STATUS"
EOF
cat >"$TMP_DIR/bin/status-json" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"protocolVersion":1,"serverId":"worker-test","serviceName":"worker-test","state":"active","substate":"running","listening":true,"runtime":"fex","gameVersion":"42.20.2","uptimeSeconds":10,"playerCount":0,"checkedAt":"2026-08-16T00:00:00Z"}'
EOF
chmod +x "$TMP_DIR/bin/sudo" "$TMP_DIR/bin/pzctl" "$TMP_DIR/bin/status-json"
export TEST_FAKE_STATUS="$TMP_DIR/bin/status-json"

python3 - "$PORT_FILE" "$EVENTS" <<'PY' &
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port_file, events_file = sys.argv[1:]
claimed = False


def record(value):
    with open(events_file, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, separators=(",", ":")) + "\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        global claimed
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body or b"{}")
        except ValueError:
            payload = {}
        if self.path.endswith("/jobs/claim"):
            record({"type": "claim"})
            if not claimed:
                claimed = True
                response = {"job": {"operationId": "operation-worker", "request": {"protocolVersion": 1, "requestId": "operation-worker", "serverId": "worker-test", "kind": "start", "payload": {}}}}
            else:
                response = {"job": None}
        elif self.path.endswith("/heartbeat"):
            record({"type": "heartbeat", "status": payload.get("status")})
            response = {"ok": True}
        elif self.path.endswith("/progress"):
            record({"type": "progress", "data": payload})
            response = {"ok": True}
        elif self.path.endswith("/logs"):
            record({"type": "logs", "data": payload})
            response = {"ok": True}
        elif self.path.endswith("/complete"):
            record({"type": "complete", "data": payload})
            response = {"ok": True}
        else:
            self.send_response(404)
            self.end_headers()
            return
        encoded = json.dumps(response, separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="ascii") as handle:
    handle.write(str(server.server_port))
server.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 30); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
[ -s "$PORT_FILE" ] || { echo 'agent worker test server did not start' >&2; exit 1; }
PORT="$(cat "$PORT_FILE")"

export TEST_CONSOLE="$CONSOLE" TEST_ROOT="$TMP_DIR" PZ_COMMON="$COMMON" PZCTL_BIN="$TMP_DIR/bin/pzctl"
export PZ_AGENT_URL="http://127.0.0.1:$PORT" PZ_AGENT_ALLOW_INSECURE=1
export PZ_AGENT_ID=agent-1 PZ_AGENT_ACCESS_TOKEN=agent-access PZ_AGENT_INTERVAL=5
export PATH="$TMP_DIR/bin:$PATH"
if timeout 14 bash "$ROOT_DIR/scripts/pz-agent.sh" --poll >"$TMP_DIR/agent.log" 2>&1; then
  :
else
  rc=$?
  [ "$rc" -eq 124 ] || { cat "$TMP_DIR/agent.log" >&2; exit "$rc"; }
fi

if ! python3 - "$EVENTS" <<'PY'
import json
import sys

records = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
heartbeats = [item for item in records if item["type"] == "heartbeat"]
progress = [item for item in records if item["type"] == "progress"]
logs = [item for item in records if item["type"] == "logs"]
completed = [item for item in records if item["type"] == "complete"]
claims = [item for item in records if item["type"] == "claim"]
if len(heartbeats) < 2:
    raise SystemExit(f"expected heartbeat during long operation, got {len(heartbeats)}")
if not progress:
    raise SystemExit("expected worker progress event")
if not logs or not any("booting" in line for item in logs for line in item["data"].get("lines", [])):
    raise SystemExit("expected incremental console log event")
if len(completed) != 1 or completed[0]["data"].get("status") != "succeeded":
    raise SystemExit(f"expected one successful completion, got {completed}")
if not claims:
    raise SystemExit("expected a job claim")
print("pz-agent worker heartbeat/log streaming test: ok")
PY
then
  cat "$TMP_DIR/agent.log" >&2
  exit 1
fi
