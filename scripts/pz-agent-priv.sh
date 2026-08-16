#!/usr/bin/env bash
#
# Root-side allowlist for pz-agent. This file is installed root-owned and is the only command
# the agent service may invoke through sudo. It never evaluates request data as shell code.
set -uo pipefail

PZCTL_BIN="${PZCTL_BIN:-/usr/local/bin/pzctl}"

usage() {
  printf 'Usage: pz-agent-priv {status|start|stop|restart|backup|logs} [lines]\n' >&2
}

case "${1:-}" in
  status|start|stop|restart|backup)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" "$1" --json
    ;;
  logs)
    lines="${2:-50}"
    [ "$#" -le 2 ] || { usage; exit 64; }
    case "$lines" in ''|*[!0-9]*) usage; exit 64 ;; esac
    [ "$lines" -ge 1 ] && [ "$lines" -le 1000 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" logs --json "$lines"
    ;;
  *)
    usage
    exit 64
    ;;
esac
