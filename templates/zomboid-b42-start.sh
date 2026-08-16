#!/usr/bin/env bash
set -euo pipefail

cd "__INSTALL_DIR__"
[ -n "${PZ_ADMIN_PW:-}" ] || { echo "PZ_ADMIN_PW is required" >&2; exit 1; }

exec ./start-server.sh "$@" -adminpassword "$PZ_ADMIN_PW"
