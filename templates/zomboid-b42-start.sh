#!/usr/bin/env bash
set -euo pipefail

cd "__INSTALL_DIR__"
if [ -s "__ADMIN_MARKER__" ]; then
  exec ./start-server.sh "$@"
fi
[ -n "${PZ_ADMIN_PW:-}" ] || { echo "PZ_ADMIN_PW is required for first bootstrap" >&2; exit 1; }

bootstrap_admin() {
  local child log_offset=0 log_size marker_tmp rc
  [ -f "__CONSOLE__" ] && log_offset="$(wc -c < "__CONSOLE__")"
  ./start-server.sh "$@" -adminpassword "$PZ_ADMIN_PW" &
  child=$!
  trap 'kill "$child" 2>/dev/null || true' TERM INT
  while kill -0 "$child" 2>/dev/null; do
    if [ -f "__CONSOLE__" ]; then
      log_size="$(wc -c < "__CONSOLE__")"
      [ "$log_size" -ge "$log_offset" ] || log_offset=0
      if [ "$log_size" -gt "$log_offset" ] &&
        tail -c +$((log_offset + 1)) "__CONSOLE__" 2>/dev/null |
          grep -Fqi -- "admin password changed via -adminpassword"; then
        umask 077
        marker_tmp="__ADMIN_MARKER__.tmp.$$"
        printf 'admin password bootstrap completed\n' > "$marker_tmp" &&
          mv -f "$marker_tmp" "__ADMIN_MARKER__"
        break
      fi
    fi
    sleep 1
  done
  wait "$child"
  rc=$?
  trap - TERM INT
  return "$rc"
}

bootstrap_admin "$@"
