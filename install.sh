#!/usr/bin/env bash
#
#  Project Zomboid Build 42 — one-shot dedicated-server installer for ARM64
#
#  Usage:   sudo ./install.sh
#
#  Turns a fresh Ubuntu/Debian ARM64 box (e.g. Oracle Cloud Ampere free tier) into a
#  running, self-restarting PZ B42 server. Then manage everything with:  pzctl
#
#  Advanced (optional env overrides, mainly for side-by-side/test installs — every
#  artifact gets namespaced so an extra install never touches the default one):
#    PZ_SVC=zomboid-b42-test        service/unit base name
#    PZ_INSTALL_DIR=/path           server files (default /opt/zomboid-server)
#    PZ_CACHEDIR=/path              Zomboid data dir (default ~/Zomboid)
#    PZ_PORT=16371                  game port (default 16261; +1 is used too)
#    PZ_RCONPORT=27025              RCON port written to the ini (default 27015)
#    PZ_BACKUPS=/path               backup dir (default ~/pz_backups)
#    PZ_SKIP_FIREWALL=1             don't touch iptables
#    PZ_RUNTIME=fex|box64                              emulation backend (default: fex)
#    PZ_FEX_COMMIT / PZ_FEX_PREFIX / PZ_FEX_ROOTFS     pinned FEX settings
#    PZ_FEX_SOURCE / PZ_FEX_JOBS                       isolated source/build controls
#    PZ_ANNOUNCED_IP=x.x.x.x                            public IP advertised to PZ/Steam
#    PZ_BRANCH / PZ_ADMIN_PW / PZ_JOIN_PW / PZ_RAM_GB   preseed the prompts
#
set -euo pipefail

# ----------------------------------------------------------------- pretty output
b()   { printf '\033[1m%s\033[0m' "$*"; }
say()  { printf '\033[1;32m>>>\033[0m %s\n' "$*"; }
step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mXXX %s\033[0m\n' "$*" >&2; exit 1; }
ask()  { local p="$1" d="${2:-}" a; read -rp "$(printf '\033[1;36m?\033[0m') $p ${d:+[$d] }" a; printf '%s' "${a:-$d}"; }

cat <<'EOF'

  Project Zomboid  B42  ->  ARM64 (FEX/box64)
  ---------------------------------------
EOF

# ----------------------------------------------------------------- 0. sanity checks
[ "$(id -u)" -eq 0 ] || die "Please run as root:  sudo ./install.sh"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) : ;;
  x86_64|amd64) die "You're on x86-64 — you do NOT need this. Run the PZ server natively; emulation is only for ARM/other non-x86 CPUs." ;;
  *) warn "Unrecognised arch '$ARCH'. The emulation backends target ARM64 (also RISC-V/LoongArch). Continuing, but you're off the tested path." ;;
esac
command -v systemctl >/dev/null || die "This installer needs systemd."
command -v apt-get   >/dev/null || die "This installer needs an apt-based distro (Ubuntu/Debian family). For others, install the selected emulation runtime and deps manually following the README."
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET_USER="${SUDO_USER:-ubuntu}"
id "$TARGET_USER" >/dev/null 2>&1 || die "User '$TARGET_USER' not found. Run via 'sudo' as your normal user."
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"

# ----------------------------------------------------------------- namespace / paths
# Defaults give the classic single-server layout. Overrides namespace everything.
SVC="${PZ_SVC:-zomboid-b42}"
[[ "$SVC" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "PZ_SVC contains unsupported characters"
SFX=""; [ "$SVC" != "zomboid-b42" ] && SFX="-${SVC#zomboid-b42-}"
INSTALL_DIR="${PZ_INSTALL_DIR:-/opt/zomboid-server}"
CACHEDIR="${PZ_CACHEDIR:-$TARGET_HOME/Zomboid}"
PORT="${PZ_PORT:-16261}"
RCONPORT="${PZ_RCONPORT:-27015}"
BACKUPS="${PZ_BACKUPS:-$TARGET_HOME/pz_backups}"
SERVERNAME=servertest
ENVFILE="/etc/${SVC}.env"
LIBDIR="/usr/local/lib/zomboid-arm${SFX}"
BIN_PZCTL="/usr/local/bin/pzctl${SFX}"
BIN_AGENT="/usr/local/sbin/pz-agent${SFX}"
BIN_AGENT_PRIV="/usr/local/sbin/pz-agent-priv${SFX}"
AGENT_ENVFILE="/etc/${SVC}-agent.env"
BIN_BOOTRETRY="/usr/local/sbin/pz-boot-retry${SFX}"
BIN_WATCHDOG="/usr/local/sbin/zomboid-watchdog${SFX}.sh"
BIN_MODUPDATE="/usr/local/sbin/pz-modupdate${SFX}"
BIN_FEXSTART="/usr/local/sbin/zomboid-fex-start${SFX}.sh"
BIN_BOXSTART="/usr/local/sbin/zomboid-b42-start${SFX}.sh"
WS="$INSTALL_DIR/steamapps/workshop/content/108600"

# FEX a08a6ce is the tested pre-FEX-2506 build. Keep the backend selectable so
# box64 remains available as a fallback on hosts where FEX is not appropriate.
RUNTIME="${PZ_RUNTIME:-}"
if [ -z "$RUNTIME" ] && [ -f "$ENVFILE" ]; then
  RUNTIME="$(grep -m1 '^PZ_RUNTIME=' "$ENVFILE" | cut -d= -f2- || true)"
fi
RUNTIME="${RUNTIME:-fex}"
case "$RUNTIME" in
  fex|box64) : ;;
  *) die "PZ_RUNTIME must be 'fex' or 'box64' (got '$RUNTIME')" ;;
esac
FEX_COMMIT="${PZ_FEX_COMMIT:-a08a6ce5de51f5e625357ecaed46c463aa1e3c99}"
FEX_PREFIX="${PZ_FEX_PREFIX:-/opt/fex-a08}"
FEX_ROOTFS="${PZ_FEX_ROOTFS:-$TARGET_HOME/.local/share/fex-emu/RootFS/Ubuntu_24_04.sqsh}"
FEX_DATA_HOME="${PZ_FEX_DATA_HOME:-$TARGET_HOME/.local/share/${SVC}-fex}"
FEX_SOCKET="${PZ_FEX_SOCKET:-/run/${SVC}-fex/fex.sock}"
ANNOUNCED_IP="${PZ_ANNOUNCED_IP:-}"
say "Service: $(b "$SVC")   user: $(b "$TARGET_USER")   data: $(b "$CACHEDIR")   runtime: $(b "$RUNTIME")"

[[ "$PORT" =~ ^[0-9]+$ ]] || die "PZ_PORT must be a number."

# ----------------------------------------------------------------- refresh package lists FIRST
# People forget `sudo apt update` on a fresh box, which then breaks every package install.
step "Refreshing package lists (apt update)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y || die "apt update failed — check the box's network/DNS, then re-run."

# ----------------------------------------------------------------- resource sanity
DETECT_GB=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo)
AVAIL_DISK_GB=$(df -BG --output=avail "$(dirname "$INSTALL_DIR")" 2>/dev/null | tail -1 | tr -dc '0-9')
[ "${DETECT_GB:-0}" -lt 6 ] && warn "Only ${DETECT_GB}G RAM. 8G+ is recommended; below 6G expect trouble (JVM + emulation overhead)."
[ "${AVAIL_DISK_GB:-99}" -lt 12 ] && warn "Only ${AVAIL_DISK_GB}G free disk. The server alone is ~7G; 12G+ free is recommended."

# ----------------------------------------------------------------- interactive config
step "Configuration (press Enter to accept defaults)"
DEF_RAM=$(( DETECT_GB>16 ? 12 : (DETECT_GB>8 ? DETECT_GB-4 : DETECT_GB/2) )); [ "$DEF_RAM" -lt 2 ] && DEF_RAM=2

if [ -n "${PZ_ADMIN_PW-}" ]; then ADMIN_PW="$PZ_ADMIN_PW"; else
  ADMIN_PW="$(ask 'Admin password (for the in-game admin account):' 'admin')"
fi
# Keep the password safe for both the protected systemd EnvironmentFile and the launcher.
bad_pw() {
  [ "${#1}" -ge 1 ] && [ "${#1}" -le 128 ] || return 0
  case "$1" in *[!A-Za-z0-9._@%+=,:/-]*) return 0 ;; *) return 1 ;; esac
}
while bad_pw "$ADMIN_PW"; do
  warn "Use 1-128 characters from letters, numbers, . _ @ % + = , : / or - for the admin password."
  ADMIN_PW="$(ask 'Admin password:' 'admin')"
done
if [ -n "${PZ_JOIN_PW+x}" ]; then JOIN_PW="$PZ_JOIN_PW"; else
  JOIN_PW="$(ask 'Join password (players type this to connect; blank = open):' '')"
fi
if [ -n "${PZ_RAM_GB-}" ]; then RAM_GB="$PZ_RAM_GB"; else
  RAM_GB="$(ask "RAM for the server in GB (host has ${DETECT_GB}G):" "$DEF_RAM")"
fi
[[ "$RAM_GB" =~ ^[0-9]+$ ]] && [ "$RAM_GB" -ge 2 ] || { warn "'$RAM_GB' isn't a valid GB amount; using ${DEF_RAM}G."; RAM_GB=$DEF_RAM; }
say "RAM ${RAM_GB}G, admin password set, join password $( [ -n "$JOIN_PW" ] && echo set || echo 'none')."

# ----------------------------------------------------------------- game branch
# B42 is the stable `public` branch now (the old `unstable` beta branch is gone).
# Offer whatever branches Steam currently has, with a built-in fallback list.
step "Game branch"
FALLBACK_BRANCHES=$'public\tB42 stable (recommended)\n42.19\tBuild 42.19.1\nlegacy41\tBuild 41.78.20 (old B41; saves are NOT compatible with B42)\noutdatedunstable\tPre-stable B42 (rollbacks / old unstable saves only)'
BRANCHES="$(curl -fsSL --max-time 8 'https://api.steamcmd.net/v1/info/380870' 2>/dev/null \
  | jq -r '.data."380870".depots.branches // {} | to_entries[]
           | select(((.value.pwdrequired // 0) | tostring) != "1")
           | [.key, (.value.description // "")] | @tsv' 2>/dev/null | grep . || true)"
if [ -n "$BRANCHES" ]; then
  BRANCHES="$(printf '%s\n' "$BRANCHES" | awk -F'\t' '
    $1=="public" { print $1 "\tB42 stable (recommended)"; next } { rest = rest $0 "\n" }
    END { printf "%s", rest }')"
  say "Live branch list fetched from Steam."
else
  BRANCHES="$FALLBACK_BRANCHES"
  warn "Couldn't fetch the live branch list; using the built-in one."
fi
DEF_BRANCH=public
if [ -f "$ENVFILE" ]; then   # re-runs default to the branch picked last time
  PREV_BRANCH="$(grep -m1 '^PZ_BRANCH=' "$ENVFILE" | cut -d= -f2 || true)"
  DEF_BRANCH="${PREV_BRANCH:-public}"
fi
mapfile -t BR_LINES <<< "$BRANCHES"
if [ -n "${PZ_BRANCH-}" ]; then
  BRANCH="$PZ_BRANCH"
else
  i=0
  for line in "${BR_LINES[@]}"; do
    i=$((i+1)); printf '   %d) %-18s %s\n' "$i" "${line%%$'\t'*}" "${line#*$'\t'}"
  done
  pick="$(ask 'Branch (number or name):' "$DEF_BRANCH")"
  if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le ${#BR_LINES[@]} ]; then
    BRANCH="${BR_LINES[$((pick-1))]%%$'\t'*}"
  else
    BRANCH="$pick"
    printf '%s\n' "$BRANCHES" | cut -f1 | grep -qx "$BRANCH" || warn "'$BRANCH' isn't in the branch list — passing it to Steam anyway."
  fi
fi
say "Branch: $(b "$BRANCH")"

# ----------------------------------------------------------------- 1. dependencies
step "Installing dependencies"
# No system Java needed (the server bundles its own x86 jre64, run via the selected runtime).
# No box86 / armhf libs needed (we use DepotDownloader, not 32-bit steamcmd).
# tcpdump powers pz-boot-retry's Steam-session health gate (relay players need a live session)
apt-get install -y -qq ciopfs fuse3 wget curl unzip jq gnupg ca-certificates python3 tcpdump >/dev/null || \
  apt-get install -y -qq ciopfs fuse wget curl unzip jq gnupg ca-certificates python3 tcpdump >/dev/null
# allow_other for the ciopfs FUSE mount
grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null || echo 'user_allow_other' >> /etc/fuse.conf

if [ "$RUNTIME" = box64 ]; then
  if ! command -v box64 >/dev/null; then
    say "Adding the Box64 apt repo (ryanfortner/box64-debs)..."
    curl -fsSL https://ryanfortner.github.io/box64-debs/box64.list -o /etc/apt/sources.list.d/box64.list
    curl -fsSL https://ryanfortner.github.io/box64-debs/KEY.gpg | gpg --dearmor -o /etc/apt/trusted.gpg.d/box64-debs-archive-keyring.gpg
    apt-get update -qq
    # Pick the build matching the hardware where it matters (Raspberry Pi), generic otherwise.
    BOX64_PKG=box64-generic-arm
    PI_MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
    case "$PI_MODEL" in
      *"Raspberry Pi 5"*) BOX64_PKG=box64-rpi5arm64 ;;
      *"Raspberry Pi 4"*) BOX64_PKG=box64-rpi4arm64 ;;
    esac
    apt-get install -y -qq "$BOX64_PKG" || apt-get install -y -qq box64-generic-arm || apt-get install -y -qq box64 || \
      die "Box64 install failed. Install it manually (https://github.com/ptitSeb/box64) and re-run."
  fi
  say "Box64 ready: $(box64 --version 2>&1 | head -1 || echo installed)"

  # Box64 must be registered with binfmt_misc so the x86-64 server binary runs transparently
  # (start-server.sh calls ./ProjectZomboid64 with no Box64 prefix). The apt package usually
  # handles this; ensure it, with a manual fallback using Box64's ELF magic + mask.
  ensure_binfmt() {
    systemctl restart systemd-binfmt 2>/dev/null || true
    if [ -e /proc/sys/fs/binfmt_misc/box64 ]; then return 0; fi
    say "Registering Box64 with binfmt_misc (fallback)..."
    mkdir -p /etc/binfmt.d
    cat > /etc/binfmt.d/box64.conf <<EOF
:box64:M::\x7f\x45\x4c\x46\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x3e\x00:\xff\xff\xff\xff\xff\xff\xff\x00\x00\x00\x00\xff\xff\xff\xff\xff\xfe\xff\xff\xff:$(command -v box64):F
EOF
    systemctl restart systemd-binfmt 2>/dev/null || true
  }
  ensure_binfmt
  [ -e /proc/sys/fs/binfmt_misc/box64 ] || warn "Box64 not registered with binfmt_misc — the server may fail to start (see README Troubleshooting)."
else
  say "FEX selected; skipping Box64 package, binfmt_misc and box64rc setup."
fi

if [ "$RUNTIME" = fex ]; then
  step "Installing pinned FEX ARM64 runtime"
  PZ_USER="$TARGET_USER" \
  PZ_FEX_COMMIT="$FEX_COMMIT" \
  PZ_FEX_PREFIX="$FEX_PREFIX" \
  PZ_FEX_ROOTFS="$FEX_ROOTFS" \
  PZ_FEX_SOURCE="${PZ_FEX_SOURCE:-/var/cache/zomboid-arm/fex-$FEX_COMMIT}" \
  PZ_FEX_JOBS="${PZ_FEX_JOBS:-2}" \
  "$REPO_DIR/scripts/install-fex.sh"
fi

# ----------------------------------------------------------------- 2. DepotDownloader
step "Setting up DepotDownloader (native ARM Steam content downloader)"
DD_DIR=/opt/depotdownloader
mkdir -p "$DD_DIR"
DD=""
if [ -x "$DD_DIR/DepotDownloader" ]; then DD="$DD_DIR/DepotDownloader"
elif [ -f "$DD_DIR/DepotDownloader.dll" ]; then DD="dotnet $DD_DIR/DepotDownloader.dll"
else
  REL="$(curl -fsSL https://api.github.com/repos/SteamRE/DepotDownloader/releases/latest)"
  URL="$(echo "$REL" | jq -r '.assets[].browser_download_url' | grep -iE 'linux-arm64' | head -1)"
  if [ -n "$URL" ] && [ "$URL" != "null" ]; then
    say "Downloading self-contained arm64 build..."
    curl -fsSL "$URL" -o /tmp/dd.zip && unzip -oq /tmp/dd.zip -d "$DD_DIR"
    chmod +x "$DD_DIR/DepotDownloader"; DD="$DD_DIR/DepotDownloader"
  else
    warn "No self-contained arm64 asset; falling back to .NET runtime + framework build."
    apt-get install -y -qq dotnet-runtime-8.0 dotnet-runtime-9.0 2>/dev/null || apt-get install -y -qq dotnet-runtime-8.0 || die "Could not install .NET runtime for DepotDownloader."
    URL="$(echo "$REL" | jq -r '.assets[].browser_download_url' | grep -iE 'framework' | head -1)"
    curl -fsSL "$URL" -o /tmp/dd.zip && unzip -oq /tmp/dd.zip -d "$DD_DIR"; DD="dotnet $DD_DIR/DepotDownloader.dll"
  fi
fi
say "DepotDownloader: $DD"

# ----------------------------------------------------------------- 3. download the server
step "Downloading Project Zomboid B42 server (branch: $BRANCH) — this can take several minutes"
mkdir -p "$INSTALL_DIR"
chown "$TARGET_USER":"$TARGET_USER" "$INSTALL_DIR"       # so DepotDownloader (run as the user) can write here
sudo -u "$TARGET_USER" env HOME="$TARGET_HOME" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 $DD -app 380870 -branch "$BRANCH" -os linux -dir "$INSTALL_DIR" \
  || die "Server download failed (Steam/DepotDownloader). Re-run to resume."
chmod +x "$INSTALL_DIR/ProjectZomboid64" "$INSTALL_DIR/ProjectZomboid32" "$INSTALL_DIR"/*.sh 2>/dev/null || true
# DepotDownloader strips execute bits — restore them on the bundled JRE, or start-server.sh
# can't launch java ("couldn't determine 32/64 bit of java") and the service just loops.
chmod +x "$INSTALL_DIR"/jre64/bin/* 2>/dev/null || true
[ -e "$INSTALL_DIR/jre64/lib/jspawnhelper" ] && chmod +x "$INSTALL_DIR/jre64/lib/jspawnhelper" || true

# ----------------------------------------------------------------- 4. config files
step "Writing JVM configuration"
if [ "$RUNTIME" = box64 ]; then
  if ! grep -q '^\[ProjectZomboid64\]' /etc/box64.box64rc 2>/dev/null; then
    cat "$REPO_DIR/templates/box64rc-ProjectZomboid64.conf" >> /etc/box64.box64rc
    say "Added [ProjectZomboid64] Box64 tuning to /etc/box64.box64rc"
  else
    say "box64rc already has a [ProjectZomboid64] section — left as-is"
  fi
else
  say "FEX selected; leaving /etc/box64.box64rc unchanged."
fi
sed "s/__XMX__/${RAM_GB}g/" "$REPO_DIR/templates/ProjectZomboid64.json" > "$INSTALL_DIR/ProjectZomboid64.json"

# ----------------------------------------------------------------- 5. ciopfs dirs
step "Preparing ciopfs (case-insensitive mods)"
if [ -d "$WS" ] && [ ! -d "${WS}.ci" ]; then mv "$WS" "${WS}.ci"; fi
mkdir -p "${WS}.ci" "$WS" "$CACHEDIR/mods" "$BACKUPS"
chown -R "$TARGET_USER":"$TARGET_USER" "$INSTALL_DIR" "$CACHEDIR" 2>/dev/null || true
chown "$TARGET_USER":"$TARGET_USER" "$BACKUPS" 2>/dev/null || true

# ----------------------------------------------------------------- 6. systemd + scripts
step "Installing systemd services, pzctl and the mod updater"
# sed replacement-side escaping for values that may hold |, & or \
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
EXTRA_ARGS=""
[ "$CACHEDIR" != "$TARGET_HOME/Zomboid" ] && EXTRA_ARGS="-cachedir=$CACHEDIR"
[ "$PORT" != 16261 ] && EXTRA_ARGS="${EXTRA_ARGS:+$EXTRA_ARGS }-port $PORT -udpport $((PORT+1))"
render() { sed -e "s|__USER__|$(esc "$TARGET_USER")|g" -e "s|__INSTALL_DIR__|$(esc "$INSTALL_DIR")|g" \
               -e "s|__HOME__|$(esc "$TARGET_HOME")|g" \
               -e "s|__SVC__|$(esc "$SVC")|g" -e "s|__PORT__|$PORT|g" \
               -e "s|__CONSOLE__|$(esc "$CACHEDIR/server-console.txt")|g" \
               -e "s|__CACHEDIR__|$(esc "$CACHEDIR")|g" \
               -e "s|__ADMIN_MARKER__|$(esc "$CACHEDIR/.admin-bootstrap-complete")|g" \
               -e "s|__SERVERNAME__|$SERVERNAME|g" -e "s|__EXTRA_ARGS__|$(esc "$EXTRA_ARGS")|g" \
               -e "s|__ENVFILE__|$(esc "$ENVFILE")|g" -e "s|__MODUPDATE__|$(esc "$BIN_MODUPDATE")|g" \
               -e "s|__WATCHDOG__|$(esc "$BIN_WATCHDOG")|g" -e "s|__LIBDIR__|$(esc "$LIBDIR")|g" \
               -e "s|__FEX_PREFIX__|$(esc "$FEX_PREFIX")|g" -e "s|__FEX_ROOTFS__|$(esc "$FEX_ROOTFS")|g" \
               -e "s|__FEX_DATA_HOME__|$(esc "$FEX_DATA_HOME")|g" -e "s|__FEX_SOCKET__|$(esc "$FEX_SOCKET")|g" \
               -e "s|__FEX_START__|$(esc "$BIN_FEXSTART")|g" -e "s|__BOX_START__|$(esc "$BIN_BOXSTART")|g" "$1"; }
if [ "$RUNTIME" = fex ]; then
  render "$REPO_DIR/templates/zomboid-fex.service" > "/etc/systemd/system/$SVC.service"
  render "$REPO_DIR/templates/zomboid-fex-start.sh" > "$BIN_FEXSTART"
  chmod 755 "$BIN_FEXSTART"
else
  render "$REPO_DIR/templates/zomboid-b42.service" > "/etc/systemd/system/$SVC.service"
  render "$REPO_DIR/templates/zomboid-b42-start.sh" > "$BIN_BOXSTART"
  chmod 755 "$BIN_BOXSTART"
fi
render "$REPO_DIR/templates/zomboid-ciopfs.service"    > "/etc/systemd/system/$SVC-ciopfs.service"
render "$REPO_DIR/templates/zomboid-watchdog.service"  > "/etc/systemd/system/$SVC-watchdog.service"
render "$REPO_DIR/templates/zomboid-watchdog.timer"    > "/etc/systemd/system/$SVC-watchdog.timer"
render "$REPO_DIR/templates/zomboid-modupdate.service" > "/etc/systemd/system/$SVC-modupdate.service"
render "$REPO_DIR/templates/zomboid-modupdate.timer"   > "/etc/systemd/system/$SVC-modupdate.timer"
sed -e "s|__USER__|$(esc "$TARGET_USER")|g" -e "s|__ENVFILE__|$(esc "$ENVFILE")|g" \
    -e "s|__AGENT_ENVFILE__|$(esc "$AGENT_ENVFILE")|g" -e "s|__CACHEDIR__|$(esc "$CACHEDIR")|g" \
    -e "s|__BACKUPS__|$(esc "$BACKUPS")|g" -e "s|__AGENT__|$(esc "$BIN_AGENT")|g" \
    "$REPO_DIR/templates/zomboid-agent.service" > "/etc/systemd/system/$SVC-agent.service"
install -m755 "$REPO_DIR/scripts/zomboid-watchdog.sh" "$BIN_WATCHDOG"
install -m755 "$REPO_DIR/scripts/boot-retry.sh"       "$BIN_BOOTRETRY"
install -m755 "$REPO_DIR/scripts/pz-modupdate.sh"     "$BIN_MODUPDATE"
install -m755 "$REPO_DIR/pzctl"                       "$BIN_PZCTL"
install -m755 "$REPO_DIR/scripts/pz-agent.sh"          "$BIN_AGENT"
install -m755 "$REPO_DIR/scripts/pz-agent-priv.sh"      "$BIN_AGENT_PRIV"
mkdir -p "$LIBDIR"
install -m644 "$REPO_DIR/scripts/common.sh"  "$LIBDIR/common.sh"
install -m755 "$REPO_DIR/scripts/zomboid-admin-bootstrap.sh" "$LIBDIR/zomboid-admin-bootstrap.sh"
install -m755 "$REPO_DIR/scripts/pz-rcon.py" "$LIBDIR/pz-rcon.py"
# namespaced installs: point the installed copies at their own env file
if [ -n "$SFX" ]; then
  sed -i "s|/etc/zomboid-b42.env|$ENVFILE|g" "$BIN_PZCTL" "$BIN_MODUPDATE" "$BIN_AGENT"
  sed -i "s|/usr/local/lib/zomboid-arm/common.sh|$LIBDIR/common.sh|g; s|/usr/local/bin/pzctl|$BIN_PZCTL|g; s|/usr/local/sbin/pz-agent-priv|$BIN_AGENT_PRIV|g" "$BIN_AGENT"
  sed -i "s|/usr/local/bin/pzctl|$BIN_PZCTL|g; s|/etc/zomboid-b42.env|$ENVFILE|g" "$BIN_AGENT_PRIV"
fi
# let pzctl & friends know the environment on this host
cat > "$ENVFILE" <<EOF
PZ_SERVICE=$SVC
PZ_USER=$TARGET_USER
PZ_INSTALL=$INSTALL_DIR
PZ_CACHEDIR=$CACHEDIR
PZ_ADMIN_MARKER=$CACHEDIR/.admin-bootstrap-complete
PZ_CONSOLE=$CACHEDIR/server-console.txt
PZ_INI=$CACHEDIR/Server/$SERVERNAME.ini
PZ_MODS=$CACHEDIR/mods
PZ_DD=$DD
PZ_PORT=$PORT
PZ_RCONPORT=$RCONPORT
PZ_BRANCH=$BRANCH
PZ_SERVERNAME=$SERVERNAME
PZ_ADMIN_PW=$ADMIN_PW
PZ_RUNTIME=$RUNTIME
PZ_FEX_COMMIT=$FEX_COMMIT
PZ_FEX_PREFIX=$FEX_PREFIX
PZ_FEX_ROOTFS=$FEX_ROOTFS
PZ_FEX_DATA_HOME=$FEX_DATA_HOME
PZ_FEX_SOCKET=$FEX_SOCKET
PZ_FEX_START=$BIN_FEXSTART
PZ_ANNOUNCED_IP=$ANNOUNCED_IP
PZ_COMMON=$LIBDIR/common.sh
PZ_RCON=$LIBDIR/pz-rcon.py
PZ_BOOTRETRY=$BIN_BOOTRETRY
PZ_WATCHDOG=$BIN_WATCHDOG
PZ_MODUPDATE=$BIN_MODUPDATE
PZ_PZCTL=$BIN_PZCTL
PZ_AGENT=$BIN_AGENT
PZ_AGENT_PRIV=$BIN_AGENT_PRIV
PZ_AGENT_ENVFILE=$AGENT_ENVFILE
PZ_CONF=$CACHEDIR/pzctl.conf
PZ_UPDATELOG=$CACHEDIR/mod-updates.log
PZ_BACKUPS=$BACKUPS
PZ_REQUIRE_STEAM=${PZ_REQUIRE_STEAM:-auto}
EOF
chown "$TARGET_USER":"$TARGET_USER" "$ENVFILE"
chmod 600 "$ENVFILE"
if [ ! -e "$AGENT_ENVFILE" ]; then
  install -o root -g "$TARGET_USER" -m640 /dev/null "$AGENT_ENVFILE" 2>/dev/null || {
    touch "$AGENT_ENVFILE"
    chown root:"$TARGET_USER" "$AGENT_ENVFILE" 2>/dev/null || true
    chmod 640 "$AGENT_ENVFILE"
  }
else
  chown root:"$TARGET_USER" "$AGENT_ENVFILE" 2>/dev/null || true
  chmod 640 "$AGENT_ENVFILE"
fi
AGENT_SUDOERS="/etc/sudoers.d/${SVC}-agent"
if [ "${PZ_AGENT_ENABLE:-0}" = 1 ]; then
  command -v visudo >/dev/null 2>&1 || die "visudo is required before enabling the host agent"
  AGENT_SUDOERS_TMP="$(mktemp "${TMPDIR:-/tmp}/${SVC}-agent-sudoers.XXXXXX")"
  trap 'rm -f "$AGENT_SUDOERS_TMP"' EXIT
  printf '%s ALL=(root) NOPASSWD: %s\n' "$TARGET_USER" "$BIN_AGENT_PRIV" > "$AGENT_SUDOERS_TMP"
  chmod 440 "$AGENT_SUDOERS_TMP"
  visudo -cf "$AGENT_SUDOERS_TMP" >/dev/null 2>&1 || die "Generated agent sudoers rule failed validation"
  install -m440 "$AGENT_SUDOERS_TMP" "$AGENT_SUDOERS"
  rm -f "$AGENT_SUDOERS_TMP"
  trap - EXIT
else
  rm -f "$AGENT_SUDOERS"
fi
systemctl daemon-reload
systemctl enable "$SVC-ciopfs.service" "$SVC.service" "$SVC-watchdog.timer" "$SVC-modupdate.timer" >/dev/null 2>&1
systemctl start  "$SVC-ciopfs.service"
if [ "${PZ_AGENT_ENABLE:-0}" = 1 ]; then
  systemctl enable --now "$SVC-agent.service"
else
  say "Host agent unit installed but disabled. Configure $AGENT_ENVFILE, then rerun with PZ_AGENT_ENABLE=1 to install its sudoers rule and enable $SVC-agent.service."
fi

# ----------------------------------------------------------------- 6b. local firewall (iptables)
# Oracle Ubuntu images ship a restrictive iptables that ends in a REJECT rule, so the game
# port is blocked locally unless explicitly allowed. (This is separate from the Oracle
# Cloud Security List, which must also be opened in the web console — see the end.)
if [ "${PZ_SKIP_FIREWALL:-0}" = 1 ]; then
  say "Skipping the firewall step (PZ_SKIP_FIREWALL=1)."
else
  step "Opening the game port in the local firewall (iptables)"
  apt-get install -y -qq iptables netfilter-persistent iptables-persistent >/dev/null 2>&1 || true
  open_udp() { iptables -C INPUT -p udp --dport "$1" -j ACCEPT 2>/dev/null || iptables -I INPUT -p udp --dport "$1" -j ACCEPT 2>/dev/null || return 1; }
  if command -v iptables >/dev/null && open_udp "$PORT" && open_udp "$((PORT+1))"; then
    netfilter-persistent save >/dev/null 2>&1 || { mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 2>/dev/null; } || true
    say "Allowed UDP $PORT-$((PORT+1)) in the local firewall (persisted)."
  else
    warn "Couldn't set iptables rules automatically — open UDP $PORT/$((PORT+1)) manually if the box has a firewall."
  fi
fi

# ----------------------------------------------------------------- 7. first boot -> generate ini
step "First boot (generates server config; the emulated ARM boot may take a few minutes)"
PZ_SERVICE="$SVC" PZ_PORT="$PORT" PZ_CONSOLE="$CACHEDIR/server-console.txt" "$BIN_BOOTRETRY" || \
  warn "Server didn't reach 'listening' automatically. You can retry later with:  ${BIN_PZCTL##*/}  (menu: Start)"

INI="$CACHEDIR/Server/$SERVERNAME.ini"
# safe key=value editing (no sed escaping pitfalls) via the shared lib
. "$REPO_DIR/scripts/common.sh"
CHANGED=0
if [ -f "$INI" ]; then
  if [ -n "$JOIN_PW" ]; then ini_set Password "$JOIN_PW" "$INI"; CHANGED=1; fi
  if [ "$RCONPORT" != 27015 ]; then ini_set RCONPort "$RCONPORT" "$INI"; CHANGED=1; fi
  if [ -z "$ANNOUNCED_IP" ] && [ "${PZ_SKIP_ANNOUNCED_IP:-0}" != 1 ]; then
    ANNOUNCED_IP="$(curl -4fsSL --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [ -n "$ANNOUNCED_IP" ]; then
    ini_set server_browser_announced_ip "$ANNOUNCED_IP" "$INI"; CHANGED=1
  fi
  chown "$TARGET_USER":"$TARGET_USER" "$INI" 2>/dev/null || true
  if [ "$CHANGED" = 1 ]; then
    systemctl restart "$SVC.service"
    say "Server settings applied."
  fi
fi

# Start the watchdog + mod-update timers NOW (not just on next boot).
systemctl start "$SVC-watchdog.timer" "$SVC-modupdate.timer" >/dev/null 2>&1 || true

# ----------------------------------------------------------------- done
PUBIP="$(curl -fsSL --max-time 5 ifconfig.me 2>/dev/null || echo YOUR_SERVER_IP)"
if [ "${PZ_SKIP_FIREWALL:-0}" = 1 ]; then
  FIREWALL_STATUS="  Local firewall: skipped (PZ_SKIP_FIREWALL=1); allow UDP $PORT-$((PORT+1)) manually."
else
  FIREWALL_STATUS="  Local firewall (iptables): allowed UDP $PORT-$((PORT+1))."
fi
step "Done"
cat <<EOF
  Server:   $(b "$PUBIP:$PORT")   (UDP)
  Branch:   $(b "$BRANCH")
  Runtime:  $(b "$RUNTIME")
  Credentials: stored in the protected server environment/configuration; not printed here.

${FIREWALL_STATUS}
  1) $(b 'Oracle Cloud users:') also allow $(b "UDP $PORT-$((PORT+1))") in your VCN Security List
     (cloud console -> Networking -> VCN -> Security Lists) — that cloud layer is
     separate from the box's firewall and cannot be opened from inside the machine.
  2) Manage the server anytime with:   $(b "${BIN_PZCTL##*/}")
       start / stop / status / logs / mods & updates / console / settings / backup

  Note: if a future game build breaks something, re-run this installer to update.
EOF
