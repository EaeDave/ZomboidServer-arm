#!/usr/bin/env bash
#
#  Uninstaller for the Project Zomboid B42 ARM server — reverses install.sh.
#
#  Usage:   sudo ./uninstall.sh
#
#  Removes the server files, systemd services, helper scripts, config and firewall
#  rules that install.sh created. Your worlds/saves are only deleted if you say yes
#  to that question, and shared emulation runtimes are left alone unless you opt in.
#
#  Heads-up: the server directory is deleted with `rm -rf`, so if you manually
#  stored unrelated files inside it (or inside ~/Zomboid and you confirm that
#  prompt), those are removed with it. Uninstalls a non-default install when
#  PZCTL_ENV points at its env file.
#
set -uo pipefail   # deliberately NOT -e: keep going even if pieces are already gone

b()   { printf '\033[1m%s\033[0m' "$*"; }
say()  { printf '\033[1;32m>>>\033[0m %s\n' "$*"; }
step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!!\033[0m %s\n' "$*"; }
ask()  { local p="$1" d="${2:-}" a; read -rp "$(printf '\033[1;36m?\033[0m') $p ${d:+[$d] }" a; printf '%s' "${a:-$d}"; }
is_yes() { case "${1,,}" in y|yes|e|evet) return 0;; *) return 1;; esac; }

cat <<'EOF'

  Project Zomboid B42  ->  UNINSTALL
  ---------------------------------
EOF
[ "$(id -u)" -eq 0 ] || { echo "Please run as root:  sudo ./uninstall.sh"; exit 1; }

# discover paths from the installer's env file (fall back to defaults)
ENVF="${PZCTL_ENV:-/etc/zomboid-b42.env}"
[ -f "$ENVF" ] && . "$ENVF"
SVC="${PZ_SERVICE:-zomboid-b42}"
SFX=""; [ "$SVC" != "zomboid-b42" ] && SFX="-${SVC#zomboid-b42-}"
PZ_USER="${PZ_USER:-ubuntu}"
PZ_HOME="$(getent passwd "$PZ_USER" | cut -d: -f6)"; PZ_HOME="${PZ_HOME:-/home/ubuntu}"
INSTALL_DIR="${PZ_INSTALL:-/opt/zomboid-server}"
CACHEDIR="${PZ_CACHEDIR:-$PZ_HOME/Zomboid}"
PORT="${PZ_PORT:-16261}"
BOOTRETRY="${PZ_BOOTRETRY:-/usr/local/sbin/pz-boot-retry}"
WATCHDOG="${PZ_WATCHDOG:-/usr/local/sbin/zomboid-watchdog.sh}"
MODUPDATE="${PZ_MODUPDATE:-/usr/local/sbin/pz-modupdate}"
BUILDUPDATE="${PZ_BUILDUPDATE:-/usr/local/sbin/pz-build-update}"
SAVE_STOP="${PZ_SAVE_STOP:-/usr/local/sbin/zomboid-save-before-stop.sh}"
PZCTL_BIN="${PZ_PZCTL:-/usr/local/bin/pzctl}"
AGENT_BIN="${PZ_AGENT:-/usr/local/sbin/pz-agent}"
AGENT_PRIV="${PZ_AGENT_PRIV:-/usr/local/sbin/pz-agent-priv}"
AGENT_ENVFILE="${PZ_AGENT_ENVFILE:-/etc/${SVC}-agent.env}"
RUNTIME="${PZ_RUNTIME:-fex}"
FEXSTART="${PZ_FEX_START:-/usr/local/sbin/zomboid-fex-start.sh}"
BOXSTART="/usr/local/sbin/zomboid-b42-start${SFX}.sh"
FEX_PREFIX="${PZ_FEX_PREFIX:-/opt/fex-a08}"
FEX_DATA_HOME="${PZ_FEX_DATA_HOME:-$PZ_HOME/.local/share/${SVC}-fex}"
LIBDIR="$(dirname "${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}")"
WS="$INSTALL_DIR/steamapps/workshop/content/108600"

echo "This removes: the PZ B42 server in $INSTALL_DIR, its systemd services, pzctl,"
echo "the watchdog + mod/build updaters, the selected runtime launcher, and"
echo "the UDP $PORT-$((PORT+1)) firewall rules."
echo
echo "Your worlds/saves in $CACHEDIR are asked about separately below, and the"
echo "shared emulation runtimes stay unless you opt in. If you manually stored"
echo "unrelated files inside those folders, move them out first."
is_yes "$(ask 'Continue? (type y to proceed)' 'n')" || { echo "Aborted."; exit 0; }

# ----------------------------------------------------------------- 1. services
step "Stopping and disabling services"
systemctl stop "$SVC.service" "$SVC-watchdog.timer" "$SVC-watchdog.service" \
               "$SVC-modupdate.timer" "$SVC-modupdate.service" "$SVC-ciopfs.service" "$SVC-agent.service" 2>/dev/null
systemctl disable "$SVC.service" "$SVC-watchdog.timer" "$SVC-modupdate.timer" "$SVC-ciopfs.service" "$SVC-agent.service" 2>/dev/null
say "stopped."

# ----------------------------------------------------------------- 2. ciopfs unmount
step "Unmounting ciopfs"
fusermount -u "$WS" 2>/dev/null || umount -l "$WS" 2>/dev/null || true
say "unmounted (if it was mounted)."

# ----------------------------------------------------------------- 3. units + scripts + env
step "Removing systemd units, scripts and pzctl"
rm -f "/etc/systemd/system/$SVC.service" \
      "/etc/systemd/system/$SVC-agent.service" \
      "/etc/sudoers.d/$SVC-agent" \
      "/etc/systemd/system/$SVC-ciopfs.service" \
      "/etc/systemd/system/$SVC-watchdog.service" \
      "/etc/systemd/system/$SVC-watchdog.timer" \
      "/etc/systemd/system/$SVC-modupdate.service" \
      "/etc/systemd/system/$SVC-modupdate.timer"
rm -f "$WATCHDOG" "$BOOTRETRY" "$MODUPDATE" "$BUILDUPDATE" "$SAVE_STOP" "$PZCTL_BIN" "$AGENT_BIN" "$AGENT_PRIV" "$ENVF" "$AGENT_ENVFILE" "$FEXSTART" "$BOXSTART"
case "$LIBDIR" in /usr/local/lib/zomboid-arm*) rm -rf "$LIBDIR" ;; esac
systemctl daemon-reload 2>/dev/null
systemctl reset-failed "$SVC.service" 2>/dev/null
say "removed."

# ----------------------------------------------------------------- 4. box64rc tuning block
step "Reverting the box64 [ProjectZomboid64] tuning"
if [ -f /etc/box64.box64rc ] && grep -q '^# Appended to.*install\.sh' /etc/box64.box64rc; then
  sed -i '/^# Appended to.*install\.sh/,$d' /etc/box64.box64rc
  say "removed the block install.sh appended."
else
  say "nothing appended by us (left box64rc untouched)."
fi

# ----------------------------------------------------------------- 5. firewall rules
step "Removing the UDP $PORT-$((PORT+1)) firewall rules"
if command -v iptables >/dev/null; then
  iptables -D INPUT -p udp --dport "$PORT" -j ACCEPT 2>/dev/null
  iptables -D INPUT -p udp --dport "$((PORT+1))" -j ACCEPT 2>/dev/null
  netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
  say "removed (the Oracle VCN Security List rule, if any, is separate — remove it in the console)."
fi

# ----------------------------------------------------------------- 6. server files
step "Deleting server files"
rm -rf "$INSTALL_DIR"
say "removed $INSTALL_DIR."
if is_yes "$(ask 'Also remove DepotDownloader (/opt/depotdownloader)? Say n if another install still uses it.' 'y')"; then
  rm -rf /opt/depotdownloader; say "removed /opt/depotdownloader."
fi

# ----------------------------------------------------------------- 7. worlds / saves (prompt)
step "Worlds and saves"
if [ -d "$CACHEDIR" ]; then
  if is_yes "$(ask "Delete your worlds & saves at $CACHEDIR too? (irreversible)" 'y')"; then
    rm -rf "$CACHEDIR"; say "worlds/saves deleted."
  else
    say "kept your worlds/saves at $CACHEDIR."
  fi
else
  say "no $CACHEDIR data found."
fi

# ----------------------------------------------------------------- 8. box64 (prompt, shared)
step "shared emulation runtimes"
if is_yes "$(ask 'Remove box64 too? Only if nothing else on this box needs x86 emulation.' 'n')"; then
  rm -f /etc/binfmt.d/box64.conf 2>/dev/null; systemctl restart systemd-binfmt 2>/dev/null || true
  apt-get remove -y -qq 'box64*' >/dev/null 2>&1 || warn "box64 wasn't an apt package (source build?) — remove /usr/local/bin/box64 by hand if you want it gone."
  say "box64 removal attempted."
else
  say "left box64 in place."
fi

if [ "$RUNTIME" = fex ]; then
  if is_yes "$(ask "Remove this install's FEX data at $FEX_DATA_HOME?" 'y')"; then
    rm -rf "$FEX_DATA_HOME"; say "removed FEX runtime data for this install."
  else
    say "left FEX runtime data in place."
  fi
  echo "  FEX binaries/source were left in $FEX_PREFIX because they may be shared by another install."
fi

step "Done"
echo "  Project Zomboid B42 server removed."
echo "  Oracle Cloud: you may also remove the UDP $PORT rule from your VCN Security List."
