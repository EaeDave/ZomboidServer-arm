#!/usr/bin/env bash
set -euo pipefail

cd "__INSTALL_DIR__"
export HOME="__HOME__"
export XDG_DATA_HOME="__FEX_DATA_HOME__"
export FEX_ROOTFS="__FEX_ROOTFS__"
export FEX_SERVERSOCKETPATH="__FEX_SOCKET__"
export FEX_MULTIBLOCK=0
export PATH="__INSTALL_DIR__/jre64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LD_LIBRARY_PATH="__INSTALL_DIR__/linux64:__INSTALL_DIR__:__INSTALL_DIR__/jre64/lib:__INSTALL_DIR__/jre64/lib/server"

# LD_PRELOAD must not contain an x86 library here: this launcher itself is an
# ARM64 process. FEX loads the x86 JVM and its libraries from the guest path.
unset LD_PRELOAD
socket_dir="$(dirname "$FEX_SERVERSOCKETPATH")"
mkdir -p "$socket_dir"
rm -f "$FEX_SERVERSOCKETPATH"
mkdir -p "$XDG_DATA_HOME"

if [ -s "__ADMIN_MARKER__" ]; then
  exec "__FEX_PREFIX__/bin/FEXLoader" -- ./ProjectZomboid64 "$@"
fi
[ -n "${PZ_ADMIN_PW:-}" ] || { echo "PZ_ADMIN_PW is required for first bootstrap" >&2; exit 1; }

bootstrap_admin() {
  local child log_offset=0 log_size marker_tmp rc
  [ -f "__CONSOLE__" ] && log_offset="$(wc -c < "__CONSOLE__")"
  "__FEX_PREFIX__/bin/FEXLoader" -- ./ProjectZomboid64 "$@" -adminpassword "$PZ_ADMIN_PW" &
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
