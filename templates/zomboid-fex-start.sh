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
[ -n "${PZ_ADMIN_PW:-}" ] || { echo "PZ_ADMIN_PW is required" >&2; exit 1; }
socket_dir="$(dirname "$FEX_SERVERSOCKETPATH")"
mkdir -p "$socket_dir"
rm -f "$FEX_SERVERSOCKETPATH"
mkdir -p "$XDG_DATA_HOME"

exec "__FEX_PREFIX__/bin/FEXLoader" -- ./ProjectZomboid64 "$@" -adminpassword "$PZ_ADMIN_PW"
