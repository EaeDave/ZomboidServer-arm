#!/usr/bin/env bash
# Best-effort defense for direct systemctl stops. Panel/CLI lifecycle commands fail closed when
# RCON cannot save; this hook gives unrelated maintenance stops the same last-chance save.
set -u

. "${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}" 2>/dev/null || exit 0
pz_load_env 2>/dev/null || exit 0
if save_world >/dev/null 2>&1; then
  rcon_cmd quit >/dev/null 2>&1 || true
fi
exit 0
