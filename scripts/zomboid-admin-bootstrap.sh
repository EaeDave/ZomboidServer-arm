#!/usr/bin/env bash

# Run a PZ launcher with -adminpassword only until the launcher confirms that the
# password was applied. The marker is deliberately separate from the world DB:
# an interrupted first boot may create the DB before creating the admin account.
run_zomboid_with_admin_bootstrap() {
  local marker="$1" console="$2"
  shift 2

  if [ -s "$marker" ]; then
    exec "$@"
  fi
  [ -n "${PZ_ADMIN_PW:-}" ] || {
    echo "PZ_ADMIN_PW is required for first bootstrap" >&2
    return 1
  }

  local child log_offset=0 log_size marker_tmp rc
  [ -f "$console" ] && log_offset="$(wc -c < "$console")"
  "$@" -adminpassword "$PZ_ADMIN_PW" &
  child=$!
  trap 'kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; exit 143' TERM INT
  while kill -0 "$child" 2>/dev/null; do
    if [ -f "$console" ]; then
      log_size="$(wc -c < "$console")"
      [ "$log_size" -ge "$log_offset" ] || log_offset=0
      if [ "$log_size" -gt "$log_offset" ] &&
        tail -c +$((log_offset + 1)) "$console" 2>/dev/null |
          grep -Fqi -- "admin password changed via -adminpassword"; then
        umask 077
        marker_tmp="${marker}.tmp.$$"
        if ! printf 'admin password bootstrap completed\n' > "$marker_tmp" ||
          ! mv -f "$marker_tmp" "$marker"; then
          rm -f "$marker_tmp"
          printf 'admin bootstrap marker could not be written\n' >&2
          kill "$child" 2>/dev/null || true
          wait "$child" 2>/dev/null || true
          trap - TERM INT
          return 1
        fi
        break
      fi
    fi
    sleep 1
  done
  if wait "$child"; then
    rc=0
  else
    rc=$?
  fi
  trap - TERM INT
  return "$rc"
}
