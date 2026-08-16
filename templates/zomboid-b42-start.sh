#!/usr/bin/env bash
set -euo pipefail

cd "__INSTALL_DIR__"
# The helper is shared by the FEX and Box64 launchers so bootstrap safety stays identical.
. "__LIBDIR__/zomboid-admin-bootstrap.sh"
run_zomboid_with_admin_bootstrap "__ADMIN_MARKER__" "__CONSOLE__" ./start-server.sh "$@"
