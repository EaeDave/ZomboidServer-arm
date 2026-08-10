#!/usr/bin/env bash
#
#  common.sh — shared library for pzctl and pz-modupdate.
#  Installed at __LIBDIR__/common.sh; sourced, never executed.
#
#  Everything resolves from the env file written by install.sh (default
#  /etc/zomboid-b42.env, overridable with PZCTL_ENV=<path>), so the same code
#  drives any number of side-by-side installs (production, test, ...).

# ------------------------------------------------------------ env / paths
pz_load_env() {
  local envfile="${PZCTL_ENV:-/etc/zomboid-b42.env}"
  [ -f "$envfile" ] && . "$envfile"
  PZ_SERVICE="${PZ_SERVICE:-zomboid-b42}"
  PZ_USER="${PZ_USER:-ubuntu}"
  PZ_HOME="$(getent passwd "$PZ_USER" | cut -d: -f6)"
  PZ_INSTALL="${PZ_INSTALL:-/opt/zomboid-server}"
  PZ_CACHEDIR="${PZ_CACHEDIR:-$PZ_HOME/Zomboid}"
  PZ_INI="${PZ_INI:-$PZ_CACHEDIR/Server/servertest.ini}"
  PZ_CONSOLE="${PZ_CONSOLE:-$PZ_CACHEDIR/server-console.txt}"
  PZ_MODS="${PZ_MODS:-$PZ_CACHEDIR/mods}"
  PZ_DD="${PZ_DD:-/opt/depotdownloader/DepotDownloader}"
  PZ_PORT="${PZ_PORT:-16261}"
  PZ_RCONPORT="${PZ_RCONPORT:-27015}"
  PZ_BRANCH="${PZ_BRANCH:-public}"
  PZ_SERVERNAME="${PZ_SERVERNAME:-servertest}"
  PZ_JSON="$PZ_INSTALL/ProjectZomboid64.json"
  PZ_WS="$PZ_INSTALL/steamapps/workshop/content/108600"
  PZ_CONF="${PZ_CONF:-$PZ_CACHEDIR/pzctl.conf}"
  PZ_MANIFEST="$PZ_MODS/.workshop-manifest.tsv"
  PZ_DISABLED="$PZ_MODS/.disabled-mods"
  PZ_UPDATELOG="${PZ_UPDATELOG:-$PZ_CACHEDIR/mod-updates.log}"
  PZ_BACKUPS="${PZ_BACKUPS:-$PZ_HOME/pz_backups}"
  PZ_RCON="${PZ_RCON:-/usr/local/lib/zomboid-arm/pz-rcon.py}"
  PZ_BOOTRETRY="${PZ_BOOTRETRY:-/usr/local/sbin/pz-boot-retry}"
  export PZ_SERVICE PZ_CONSOLE PZ_PORT
}

# ------------------------------------------------------------ small utils
bold() { printf '\033[1m%s\033[0m' "$*"; }
grn()  { printf '\033[1;32m%s\033[0m' "$*"; }
red()  { printf '\033[1;31m%s\033[0m' "$*"; }
ylw()  { printf '\033[1;33m%s\033[0m' "$*"; }

as_user() {
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$PZ_USER" env HOME="$PZ_HOME" DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 "$@"
  else
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 "$@"
  fi
}
fix_owner()    { [ "$(id -u)" -eq 0 ] && chown -R "$PZ_USER":"$PZ_USER" "$@" 2>/dev/null || true; }
is_listening() { sudo ss -uln 2>/dev/null | grep -qE ":$PZ_PORT\b"; }
svc_active()   { [ "$(sudo systemctl is-active "$PZ_SERVICE" 2>/dev/null)" = active ]; }

# ------------------------------------------------------------ ini / conf editing
# awk with values passed through the environment: immune to sed/awk escaping issues
# no matter what characters a password or server name contains.
ini_get() { grep -m1 "^$1=" "${2:-$PZ_INI}" 2>/dev/null | cut -d= -f2- | tr -d '\r'; }
ini_set() {  # ini_set KEY VALUE [FILE]
  local f="${3:-$PZ_INI}"
  [ -f "$f" ] || touch "$f"
  K="$1" V="$2" awk '
    BEGIN { k=ENVIRON["K"]; v=ENVIRON["V"]; done=0 }
    index($0, k"=")==1 { print k"="v; done=1; next }
    { print }
    END { if (!done) print k"="v }
  ' "$f" > "$f.pztmp" && mv "$f.pztmp" "$f"
}
conf_get() {  # conf_get KEY DEFAULT
  local v; v="$(ini_get "$1" "$PZ_CONF")"
  printf '%s' "${v:-$2}"
}
conf_set() { ini_set "$1" "$2" "$PZ_CONF"; fix_owner "$PZ_CONF"; }

# Mods= helpers -------------------------------------------------------------
mods_get() { ini_get Mods; }
mods_set() { ini_set Mods "$1"; fix_owner "$PZ_INI"; }
mods_has() { printf ';%s;' "$(mods_get)" | grep -qF ";$1;"; }
mods_append() { local cur; cur="$(mods_get)"; mods_has "$1" || mods_set "${cur:+$cur;}$1"; }

# ------------------------------------------------------------ workshop helpers
extract_ws_id() { printf '%s' "$1" | grep -oE '[0-9]{6,}' | head -1; }

# If the id is a Workshop COLLECTION, echo its child mod ids; otherwise echo the id.
# Scrapes the page (works for public AND unlisted collections; the API 404s on unlisted).
resolve_ws_ids() {
  local id="$1" tmp; tmp="$(mktemp)"
  curl -s --max-time 25 -A 'Mozilla/5.0' "https://steamcommunity.com/sharedfiles/filedetails/?id=$id" -o "$tmp" 2>/dev/null
  if grep -q 'class="collectionItem"' "$tmp" 2>/dev/null; then
    grep -oE 'sharedfile_[0-9]+' "$tmp" | grep -oE '[0-9]+' | sort -u | grep -v "^${id}$"
  else
    printf '%s\n' "$id"
  fi
  rm -f "$tmp"
}

# ws_details ID [ID...] — one batched call to Steam's public API.
# Echoes one line per item: <id>\t<time_updated>\t<title>   (0 + "?" when unknown)
ws_details() {
  [ $# -eq 0 ] && return 0
  local data="itemcount=$#" i=0 id out
  for id in "$@"; do data="$data&publishedfileids%5B$i%5D=$id"; i=$((i+1)); done
  out="$(curl -s --max-time 25 -X POST -d "$data" \
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/?format=json' 2>/dev/null)"
  printf '%s' "$out" | jq -r '
    (.response.publishedfiledetails // [])[] |
    [(.publishedfileid // "?"), (.time_updated // 0), ((.title // "?") | gsub("[\\t\\n\\r]"; " "))] | @tsv
  ' 2>/dev/null
}

# manifest: <workshop_id>\t<time_updated>\t<mod_id,mod_id>\t<title> ---------------
manifest_set() {  # manifest_set WID TIME MODIDS TITLE
  mkdir -p "$PZ_MODS"; [ -f "$PZ_MANIFEST" ] || touch "$PZ_MANIFEST"
  W="$1" T="$2" M="$3" N="$4" awk -F'\t' '
    BEGIN { OFS="\t"; done=0 }
    $1==ENVIRON["W"] { print ENVIRON["W"], ENVIRON["T"], ENVIRON["M"], ENVIRON["N"]; done=1; next }
    NF { print }
    END { if (!done) print ENVIRON["W"], ENVIRON["T"], ENVIRON["M"], ENVIRON["N"] }
  ' "$PZ_MANIFEST" > "$PZ_MANIFEST.pztmp" && mv "$PZ_MANIFEST.pztmp" "$PZ_MANIFEST"
  fix_owner "$PZ_MANIFEST"
}
manifest_del()  { [ -f "$PZ_MANIFEST" ] || return 0; W="$1" awk -F'\t' 'NF && $1!=ENVIRON["W"]' "$PZ_MANIFEST" > "$PZ_MANIFEST.pztmp" && mv "$PZ_MANIFEST.pztmp" "$PZ_MANIFEST"; }
# drop manifest rows whose mods are neither active (Mods=) nor parked in .disabled-mods,
# so update checks stop re-downloading items the user removed
manifest_prune() {
  [ -f "$PZ_MANIFEST" ] || return 0
  local act=";$(mods_get);"
  [ -f "$PZ_DISABLED" ] && act="$act;$(tr '\n' ';' < "$PZ_DISABLED")"
  ACT="$act" awk -F'\t' 'NF {
    n = split($3, ids, ","); keep = 0
    for (i = 1; i <= n; i++) if (ids[i] != "" && index(ENVIRON["ACT"], ";" ids[i] ";")) keep = 1
    if (keep) print
  }' "$PZ_MANIFEST" > "$PZ_MANIFEST.pztmp" && mv "$PZ_MANIFEST.pztmp" "$PZ_MANIFEST"
  fix_owner "$PZ_MANIFEST"
}
manifest_ids()  { [ -f "$PZ_MANIFEST" ] && cut -f1 "$PZ_MANIFEST" | grep -E '^[0-9]+$' || true; }
manifest_row()  { [ -f "$PZ_MANIFEST" ] && grep -m1 "^$1	" "$PZ_MANIFEST" || true; }

# Download ONE workshop item and install every mod inside it as a LOCAL mod.
# Echoes one installed mod id per line; returns non-zero if the download failed.
# Also records/updates the item in the workshop manifest (for update checking).
install_workshop_item() {
  local wid="$1" tmp modsdir root info mid; local -a roots=() mids=()
  # the temp dir must belong to the game user: DepotDownloader runs as that user
  # even when this code runs as root (systemd timer), and root's mktemp -d would
  # hand it an unwritable 700 directory
  tmp="$(as_user mktemp -d)"
  [ -d "$tmp" ] || return 1
  as_user $PZ_DD -app 108600 -pubfile "$wid" -dir "$tmp" >/dev/null 2>&1 || { rm -rf "$tmp"; return 1; }
  # Each mod is an immediate subdirectory of the item's mods/ folder. Ignore nested version
  # subfolders like 42/ (B42 mods carry a mod.info there too -> would look like a separate mod).
  modsdir="$(find "$tmp" -type d -name mods | head -1)"
  if [ -n "$modsdir" ]; then
    for root in "$modsdir"/*/; do [ -d "$root" ] && roots+=("${root%/}"); done
  else
    while IFS= read -r info; do roots+=("$(dirname "$info")"); done < <(find "$tmp" -name mod.info)
  fi
  mkdir -p "$PZ_MODS"
  for root in "${roots[@]}"; do
    info="$root/mod.info"; [ -f "$info" ] || info="$(find "$root" -maxdepth 2 -name mod.info | head -1)"
    mid="$(grep -m1 '^id=' "$info" 2>/dev/null | cut -d= -f2- | tr -d '\r')"
    [ -z "$mid" ] && continue
    rm -rf "${PZ_MODS:?}/$(basename "$root")"
    cp -r "$root" "$PZ_MODS/"
    mods_append "$mid"
    mids+=("$mid")
    printf '%s\n' "$mid"
  done
  rm -rf "$tmp"
  [ ${#mids[@]} -eq 0 ] && return 1
  # record in the manifest so pz-modupdate can watch this item for updates
  local det t title
  det="$(ws_details "$wid" | head -1)"
  t="$(printf '%s' "$det" | cut -f2)"; title="$(printf '%s' "$det" | cut -f3)"
  manifest_set "$wid" "${t:-0}" "$(IFS=,; echo "${mids[*]}")" "${title:-?}"
  return 0
}

# ------------------------------------------------------------ RCON
rcon_ready() { [ -n "$(ini_get RCONPassword)" ]; }
rcon_cmd() {  # rcon_cmd "command with args"  -> stdout; rc!=0 on failure
  local port pw rc
  port="$(ini_get RCONPort)"; port="${port:-$PZ_RCONPORT}"
  pw="$(ini_get RCONPassword)"
  [ -z "$pw" ] && return 3
  RCON_PASSWORD="$pw" python3 "$PZ_RCON" --host 127.0.0.1 --port "$port" -- "$1" 2>/dev/null && return 0
  rc=$?
  # right after a boot the game port is up a few seconds before the RCON socket; retry once
  sleep 3
  RCON_PASSWORD="$pw" python3 "$PZ_RCON" --host 127.0.0.1 --port "$port" -- "$1" 2>/dev/null || return $rc
}
# player_count: echoes a number, or -1 when it cannot tell (RCON off/unreachable)
player_count() {
  local out n
  out="$(rcon_cmd players)" || { echo -1; return; }
  n="$(printf '%s\n' "$out" | grep -oE 'Players connected \(([0-9]+)\)' | grep -oE '[0-9]+' | head -1)"
  [ -n "$n" ] && echo "$n" || echo -1
}

# ------------------------------------------------------------ backups + update log
backup_world() {  # backup_world DESTDIR PREFIX  -> echoes archive path
  local dir="$1" prefix="$2" ts out srv="${PZ_INI%/*}" sav="$PZ_CACHEDIR/Saves"
  ts="$(date +%Y%m%d_%H%M%S)"; mkdir -p "$dir"
  out="$dir/${prefix}_$ts.tar.gz"
  # tar from / so this works no matter where the cachedir lives; a missing Saves/
  # (fresh server, no world yet) still archives the Server/ config half.
  as_user tar czf "$out" -C / "${srv#/}" "${sav#/}" 2>/dev/null
  fix_owner "$dir"
  echo "$out"
}
rotate_backups() {  # rotate_backups DIR PREFIX KEEP
  local n=0 f
  while IFS= read -r f; do
    n=$((n+1)); [ "$n" -gt "$3" ] && rm -f "$f"
  done < <(ls -1t "$1/$2"_*.tar.gz 2>/dev/null)
}
log_modupdate() {  # log_modupdate "message"  (capped at 1000 entries)
  printf '%s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "$1" >> "$PZ_UPDATELOG"
  if [ "$(wc -l < "$PZ_UPDATELOG" 2>/dev/null || echo 0)" -gt 1000 ]; then
    tail -n 1000 "$PZ_UPDATELOG" > "$PZ_UPDATELOG.pztmp" && mv "$PZ_UPDATELOG.pztmp" "$PZ_UPDATELOG"
  fi
  fix_owner "$PZ_UPDATELOG"
}
