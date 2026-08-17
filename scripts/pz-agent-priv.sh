#!/usr/bin/env bash
#
# Root-side allowlist for pz-agent. This file is installed root-owned and is the only command
# the agent service may invoke through sudo. It never evaluates request data as shell code.
set -uo pipefail

PZCTL_BIN="/usr/local/bin/pzctl"

usage() {
  printf 'Usage: pz-agent-priv {status|start|stop|restart|backup|logs|mods-list|mods-add|mods-remove|settings|settings-read|world-reset} [args]\n' >&2
}

case "${1:-}" in
  status|start|stop|restart)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" "$1" --json
    ;;
  backup)
    [ "$#" -le 2 ] || { usage; exit 64; }
    case "${2:-}" in ''|*[!0-9]*) [ "$#" -eq 1 ] || { usage; exit 64; } ;; esac
    [ -z "${2:-}" ] || { [ "$2" -ge 1 ] && [ "$2" -le 100 ] || { usage; exit 64; }; }
    exec "$PZCTL_BIN" backup --json "${2:-}"
    ;;
  logs)
    lines="${2:-50}"
    [ "$#" -le 2 ] || { usage; exit 64; }
    case "$lines" in ''|*[!0-9]*) usage; exit 64 ;; esac
    [ "$lines" -ge 1 ] && [ "$lines" -le 1000 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" logs --json "$lines"
    ;;
  mods-list)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" mods-list --json
    ;;
  mods-add)
    [ "$#" -eq 2 ] || { usage; exit 64; }
    case "$2" in *[!0-9]*) usage; exit 64 ;; esac
    exec "$PZCTL_BIN" mods-add --json "$2"
    ;;
  mods-remove)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" mods-remove --json
    ;;
  settings)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" settings --json
    ;;
  settings-read)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" settings-read --json
    ;;
  world-reset)
    [ "$#" -eq 1 ] || { usage; exit 64; }
    exec "$PZCTL_BIN" world-reset --json
    ;;
  *)
    usage
    exit 64
    ;;
esac
