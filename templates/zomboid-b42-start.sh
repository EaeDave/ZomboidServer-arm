#!/usr/bin/env bash
set -euo pipefail

cd "__INSTALL_DIR__"
if [ -f "__CACHEDIR__/db/__SERVERNAME__.db" ]; then
  exec ./start-server.sh "$@"
fi
[ -n "${PZ_ADMIN_PW:-}" ] || { echo "PZ_ADMIN_PW is required for first bootstrap" >&2; exit 1; }
exec ./start-server.sh "$@" -adminpassword "$PZ_ADMIN_PW"
