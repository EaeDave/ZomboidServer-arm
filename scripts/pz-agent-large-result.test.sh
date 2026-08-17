#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"; SERVER_PID=""
cleanup() { [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT
mkdir -p "$TMP_DIR/bin"; : >"$TMP_DIR/console"
cat >"$TMP_DIR/common.sh" <<'EOF'
pz_load_env() { PZ_SERVER_ID=large-test; PZ_SERVICE=large-test; PZ_CONSOLE="$TEST_ROOT/console"; PZ_CACHEDIR="$TEST_ROOT"; PZ_SERVERNAME=servertest; PZ_STEAM_SESSION_CHECK=disabled; PZ_STEAM_SESSION_STATUS="$TEST_ROOT/steam.json"; export PZ_SERVER_ID PZ_SERVICE PZ_CONSOLE PZ_CACHEDIR PZ_SERVERNAME PZ_STEAM_SESSION_CHECK PZ_STEAM_SESSION_STATUS; }
EOF
cat >"$TMP_DIR/bin/sudo" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = -n ] && shift
shift
case "${1:-}" in
 status) printf '%s\n' '{"protocolVersion":1,"serverId":"large-test","serviceName":"large-test","state":"active","substate":"running","listening":true,"runtime":"fex","gameVersion":"42.20.2","uptimeSeconds":1,"playerCount":0,"checkedAt":"2026-08-17T00:00:00Z"}' ;;
 config-read) python3 -c 'import json; print(json.dumps({"revision":"a"*64,"generatedAt":"now","fields":[{"source":"sandbox","path":"Mod.Field"+str(i),"label":"Field","category":"mods","categoryLabel":"Mods","type":"string","value":"x"*500,"configured":True,"description":"d"*500,"editable":True,"sensitive":False,"requiresRestart":True} for i in range(500)],"warnings":[]}))' ;;
 *) exit 64 ;;
esac
EOF
cat >"$TMP_DIR/bin/pzctl" <<'EOF'
#!/usr/bin/env bash
exec sudo ignored status
EOF
chmod +x "$TMP_DIR/bin/"*
python3 - "$TMP_DIR/port" "$TMP_DIR/result" <<'PY' &
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
port_file, result_file=sys.argv[1:]; claimed=False
class H(BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_POST(self):
  global claimed
  raw=self.rfile.read(int(self.headers.get("content-length","0")))
  body=json.loads(raw or b"{}")
  if self.path.endswith('/jobs/claim'):
   response={"job":None}
   if not claimed:
    claimed=True; response={"job":{"operationId":"large-op","request":{"protocolVersion":1,"requestId":"large-op","serverId":"large-test","kind":"config.read","payload":{}}}}
  elif self.path.endswith('/complete'):
   fields=len(body.get("result",{}).get("fields",[])); open(result_file,'w').write(f"{len(raw)} {fields}\n"); response={"ok":True}
  elif self.path.endswith('/console'):
   response={"ok":True,"cursor":body.get("cursor",0)}
  else: response={"ok":True}
  data=json.dumps(response).encode(); self.send_response(200); self.send_header('content-length',str(len(data))); self.end_headers(); self.wfile.write(data)
s=ThreadingHTTPServer(('127.0.0.1',0),H); open(port_file,'w').write(str(s.server_port)); s.serve_forever()
PY
SERVER_PID=$!
for _ in $(seq 1 30); do [ -s "$TMP_DIR/port" ] && break; sleep .1; done
export TEST_ROOT="$TMP_DIR" PZ_COMMON="$TMP_DIR/common.sh" PZCTL_BIN="$TMP_DIR/bin/pzctl" PATH="$TMP_DIR/bin:$PATH"
export PZ_AGENT_URL="http://127.0.0.1:$(cat "$TMP_DIR/port")" PZ_AGENT_ALLOW_INSECURE=1 PZ_AGENT_ID=a PZ_AGENT_ACCESS_TOKEN=t PZ_AGENT_INTERVAL=5
set +e; timeout 12 bash "$ROOT_DIR/scripts/pz-agent.sh" --poll >"$TMP_DIR/log" 2>&1; rc=$?; set -e
[ "$rc" -eq 124 ] || { cat "$TMP_DIR/log"; exit "$rc"; }
[ -s "$TMP_DIR/result" ] || { cat "$TMP_DIR/log"; exit 1; }
read -r bytes fields <"$TMP_DIR/result"
[ "$bytes" -gt 131072 ] && [ "$fields" -eq 500 ]
echo "pz-agent large result test: ok ($bytes bytes, $fields fields)"
