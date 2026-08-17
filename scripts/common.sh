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
  PZ_SERVER_ID="${PZ_SERVER_ID:-$PZ_SERVICE}"
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
  PZ_RUNTIME="${PZ_RUNTIME:-fex}"
  PZ_FEX_COMMIT="${PZ_FEX_COMMIT:-}"
  PZ_FEX_PREFIX="${PZ_FEX_PREFIX:-}"
  PZ_FEX_ROOTFS="${PZ_FEX_ROOTFS:-}"
  PZ_FEX_DATA_HOME="${PZ_FEX_DATA_HOME:-}"
  PZ_FEX_SOCKET="${PZ_FEX_SOCKET:-}"
  PZ_FEX_START="${PZ_FEX_START:-}"
  PZ_JSON="$PZ_INSTALL/ProjectZomboid64.json"
  PZ_WS="$PZ_INSTALL/steamapps/workshop/content/108600"
  PZ_CONF="${PZ_CONF:-$PZ_CACHEDIR/pzctl.conf}"
  PZ_MANIFEST="$PZ_MODS/.workshop-manifest.tsv"
  PZ_COLLECTIONS="$PZ_MODS/.workshop-collections.tsv"
  PZ_DISABLED="$PZ_MODS/.disabled-mods"
  PZ_UPDATELOG="${PZ_UPDATELOG:-$PZ_CACHEDIR/mod-updates.log}"
  PZ_BACKUPS="${PZ_BACKUPS:-$PZ_HOME/pz_backups}"
  PZ_RCON="${PZ_RCON:-/usr/local/lib/zomboid-arm/pz-rcon.py}"
  # This executable crosses the sudo boundary in pz-agent-priv. Resolve it from
  # this root-owned installed library, never from the user-editable env file.
  PZ_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pz-config.py"
  PZ_BOOTRETRY="${PZ_BOOTRETRY:-/usr/local/sbin/pz-boot-retry}"
  PZ_BASEMAP="${PZ_BASEMAP:-Muldraugh, KY}"
  # Steam Relay is a client connectivity requirement on Oracle/cloud NAT.  This setting only
  # controls *local telemetry* collected after the game is ready; it never changes Steam in PZ.
  # Map the old, undocumented PZ_REQUIRE_STEAM setting once so existing explicit strict installs
  # retain their intent, while the old auto default becomes the safe non-blocking observe mode.
  if [ -z "${PZ_STEAM_SESSION_CHECK:-}" ]; then
    case "${PZ_REQUIRE_STEAM:-auto}" in
      1|required) PZ_STEAM_SESSION_CHECK=required ;;
      0|disabled) PZ_STEAM_SESSION_CHECK=disabled ;;
      *) PZ_STEAM_SESSION_CHECK=observe ;;
    esac
  fi
  case "$PZ_STEAM_SESSION_CHECK" in observe|required|disabled) ;; *) PZ_STEAM_SESSION_CHECK=observe ;; esac
  PZ_STEAM_SESSION_STATUS="${PZ_STEAM_SESSION_STATUS:-$PZ_CACHEDIR/pz-steam-session.json}"
  # keys that identify THIS host/world; import must never take these from a foreign ini
  PZ_INI_PRESERVE=" DefaultPort UDPPort RCONPort RCONPassword Password PublicName SteamPort1 SteamPort2 WorkshopItems Mods Map ServerPlayerID ResetID Seed SteamVAC server_browser_announced_ip "
  export PZ_SERVICE PZ_SERVER_ID PZ_CONSOLE PZ_PORT PZ_RUNTIME PZ_STEAM_SESSION_CHECK \
    PZ_STEAM_SESSION_STATUS
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
fix_owner() { [ "$(id -u)" -eq 0 ] && chown -R "$PZ_USER":"$PZ_USER" "$@" 2>/dev/null || true; }
read_systemctl() {
  local output
  if output="$(systemctl "$@" 2>/dev/null)"; then
    printf '%s\n' "$output"
  else
    sudo -n systemctl "$@"
  fi
}
read_ss() {
  local output
  if output="$(ss "$@" 2>/dev/null)"; then
    printf '%s\n' "$output"
  else
    sudo -n ss "$@"
  fi
}
is_listening() { read_ss -uln 2>/dev/null | grep -qE ":$PZ_PORT\b"; }
svc_active() { [ "$(read_systemctl is-active "$PZ_SERVICE" 2>/dev/null)" = active ]; }

# Machine-readable status for pzctl, the host agent and tests. The default path avoids RCON
# while the server is booting. PZ_STATUS_RCON=1 enables player telemetry behind a strict
# outer deadline and a 15-second cache, bounding both latency and query frequency.
status_json() {
  local active sub state listening version active_enter uptime_seconds players runtime checked_at players_raw rcon_available
  active="$(read_systemctl show "$PZ_SERVICE" -p ActiveState --value 2>/dev/null || true)"
  sub="$(read_systemctl show "$PZ_SERVICE" -p SubState --value 2>/dev/null || true)"
  case "$active" in
    active) state=active ;;
    inactive) state=inactive ;;
    failed) state=failed ;;
    *) state=unknown ;;
  esac

  listening=false
  if read_ss -H -uln 2>/dev/null | grep -qE ":${PZ_PORT}([[:space:]]|$)"; then
    listening=true
  fi

  version="$(grep -am1 -oE 'version=[0-9][0-9.]*' "$PZ_CONSOLE" 2>/dev/null | cut -d= -f2 || true)"
  active_enter="$(read_systemctl show "$PZ_SERVICE" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
  uptime_seconds=null
  if [ "$active" = active ] && [ -n "$active_enter" ]; then
    local entered now
    entered="$(date -d "$active_enter" +%s 2>/dev/null || true)"
    now="$(date +%s)"
    if [ -n "$entered" ] && [ "$entered" -le "$now" ] 2>/dev/null; then
      uptime_seconds=$((now - entered))
    fi
  fi

  players=-1
  players_raw=""
  rcon_available=false
  if [ "${PZ_STATUS_RCON:-0}" = 1 ] && [ "$active" = active ] && [ "$listening" = true ] && rcon_ready; then
    local players_cache players_meta cache_mtime now cached_active cached_ok players_lock_fd safe_service
    safe_service="${PZ_SERVICE//[^A-Za-z0-9_.-]/_}"
    # The privileged probe must never create predictable files in a directory
    # writable by the game account. /run is root-owned and cleared on boot.
    install -d -o root -g root -m 0700 /run/zomboid-arm
    players_cache="/run/zomboid-arm/status-rcon-${safe_service}.cache"
    players_meta="${players_cache}.meta"
    if mkdir -p "$(dirname "$players_cache")" 2>/dev/null; then
      exec {players_lock_fd}>"${players_cache}.lock"
      if flock -w 3 "$players_lock_fd"; then
        # Re-check freshness only after taking the lock so concurrent status
        # probes cannot issue duplicate RCON requests or race cache writes.
        cache_mtime="$(stat -c %Y "$players_cache" 2>/dev/null || printf 0)"
        now="$(date +%s)"
        cached_active="$(head -1 "$players_meta" 2>/dev/null || true)"
        cached_ok="$(tail -n 1 "$players_meta" 2>/dev/null || true)"
        if [ $((now - cache_mtime)) -lt 15 ] && [ "$cached_active" = "$active_enter" ] && [ "$cached_ok" = 1 ]; then
          players_raw="$(head -c 32768 "$players_cache" 2>/dev/null || true)"
          rcon_available=true
        elif players_raw="$(rcon_cmd_quick players 2>/dev/null)"; then
          players_raw="$(printf '%s' "$players_raw" | head -c 32768)"
          if printf '%s\n' "$players_raw" | grep -qE 'Players connected \([0-9]+\)|^[[:space:]]*[-*][[:space:]]*[^[:space:]]'; then
            rcon_available=true
            printf '%s' "$players_raw" > "${players_cache}.pztmp"
            printf '%s\n1\n' "$active_enter" > "${players_meta}.pztmp"
            chmod 600 "${players_cache}.pztmp" "${players_meta}.pztmp"
            mv "${players_cache}.pztmp" "$players_cache"
            mv "${players_meta}.pztmp" "$players_meta"
          else
            players_raw=""
            rm -f "$players_cache" "$players_meta"
          fi
        else
          players_raw=""
          rm -f "$players_cache" "$players_meta"
        fi
        flock -u "$players_lock_fd"
      fi
      exec {players_lock_fd}>&-
    fi
    if [ "$rcon_available" = true ]; then
      players="$(printf '%s\n' "$players_raw" | grep -oE 'Players connected \(([0-9]+)\)' | grep -oE '[0-9]+' | head -1)"
      players="${players:--1}"
    fi
  fi
  case "$PZ_RUNTIME" in fex|box64) runtime="$PZ_RUNTIME" ;; *) runtime=unknown ;; esac
  checked_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  STATUS_SERVER_ID="$PZ_SERVER_ID" \
  STATUS_SERVICE="$PZ_SERVICE" \
  STATUS_STATE="$state" \
  STATUS_SUBSTATE="$sub" \
  STATUS_LISTENING="$listening" \
  STATUS_RUNTIME="$runtime" \
  STATUS_VERSION="$version" \
  STATUS_UPTIME="$uptime_seconds" \
  STATUS_PLAYERS="$players" \
  STATUS_PLAYERS_RAW="$players_raw" \
  STATUS_RCON_AVAILABLE="$rcon_available" \
  STATUS_CHECKED_AT="$checked_at" \
  STATUS_STEAM_CHECK="$PZ_STEAM_SESSION_CHECK" \
  STATUS_STEAM_FILE="$PZ_STEAM_SESSION_STATUS" \
  STATUS_ACTIVE_ENTER="$active_enter" \
  python3 - <<'PY'
import json
import os
import re


def nullable(value):
    return None if value in {"", "null"} else value


uptime = nullable(os.environ["STATUS_UPTIME"])


def online_players():
    raw = os.environ.get("STATUS_PLAYERS_RAW", "")
    if not raw:
        return []
    names = []
    for line in raw.splitlines():
        match = re.match(r"^\s*[-*]\s*(\S.*)$", line)
        if not match:
            continue
        candidate = match.group(1).strip()
        # PZ commonly emits '-username'; keep only bounded display text.
        candidate = candidate[:128]
        if candidate not in names:
            names.append(candidate)
            if len(names) == 100:
                break
    return names[:100]


def steam_session():
    default = {
        "mode": os.environ["STATUS_STEAM_CHECK"],
        "evidence": "not_checked",
        "checkedAt": None,
        "message": "Relay telemetry has not run since this boot.",
    }
    try:
        with open(os.environ["STATUS_STEAM_FILE"], encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, ValueError, TypeError):
        return default
    if not isinstance(value, dict):
        return default
    mode = value.get("mode")
    evidence = value.get("evidence")
    checked_at = value.get("checkedAt")
    message = value.get("message")
    service_active_since = value.get("serviceActiveSince")
    if mode not in {"observe", "required", "disabled"}:
        return default
    if evidence not in {"observed", "not_observed", "not_checked"}:
        return default
    if checked_at is not None and (not isinstance(checked_at, str) or not checked_at):
        return default
    if message is not None and (not isinstance(message, str) or not message):
        return default
    # Telemetry belongs to a particular systemd service activation. Do not present a prior
    # boot's packet sample after a manual/systemd restart that bypassed pz-boot-retry.
    if not isinstance(service_active_since, str) or not service_active_since:
        return default
    if service_active_since != os.environ["STATUS_ACTIVE_ENTER"]:
        return default
    return {"mode": mode, "evidence": evidence, "checkedAt": checked_at, "message": message}


print(
    json.dumps(
        {
            "protocolVersion": 1,
            "serverId": os.environ["STATUS_SERVER_ID"],
            "serviceName": os.environ["STATUS_SERVICE"],
            "state": os.environ["STATUS_STATE"],
            "substate": nullable(os.environ["STATUS_SUBSTATE"]),
            "listening": os.environ["STATUS_LISTENING"] == "true",
            "runtime": os.environ["STATUS_RUNTIME"],
            "gameVersion": nullable(os.environ["STATUS_VERSION"]),
            "uptimeSeconds": int(uptime) if uptime is not None else None,
            "playerCount": int(os.environ["STATUS_PLAYERS"]),
            "onlinePlayers": online_players(),
            "rconAvailable": os.environ["STATUS_RCON_AVAILABLE"] == "true",
            "checkedAt": os.environ["STATUS_CHECKED_AT"],
            "steamSession": steam_session(),
        },
        separators=(",", ":"),
    )
)
PY
}

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
mods_set() { ini_set Mods "$1" || return; fix_owner "$PZ_INI"; }
mods_has() { printf ';%s;' "$(mods_get)" | grep -qF ";$1;"; }
mods_append() { local cur; cur="$(mods_get)"; mods_has "$1" || mods_set "${cur:+$cur;}$1"; }
mod_disabled() { [ -f "$PZ_DISABLED" ] && grep -qxF "$1" "$PZ_DISABLED"; }
# every mod id present on disk (one line each), regardless of active/disabled
disk_mod_ids() {
  find "$PZ_MODS" -maxdepth 3 -name mod.info -exec grep -h '^id=' {} + 2>/dev/null \
    | cut -d= -f2- | tr -d '\r' | sort -u
}

# Map= helpers ---------------------------------------------------------------
# B42 map mods ship their cells under <Mod>/media/maps/<Name>, <Mod>/42/media/maps/<Name>
# or <Mod>/common/media/maps/<Name>. A map only loads when <Name> is listed in Map=,
# custom maps first and the base map last. pzctl keeps Map= in sync automatically.
map_get() { ini_get Map; }
map_set() { ini_set Map "$1"; fix_owner "$PZ_INI"; }

# "<modid>\t<mapname>" for every map folder shipped by installed mods
mods_map_table() {
  local top info id d
  for top in "$PZ_MODS"/*/; do
    [ -d "$top" ] || continue
    info="$(find "${top%/}" -maxdepth 2 -name mod.info 2>/dev/null | head -1)"
    id="$(grep -m1 '^id=' "$info" 2>/dev/null | cut -d= -f2- | tr -d '\r')"
    [ -z "$id" ] && continue
    while IFS= read -r d; do
      printf '%s\t%s\n' "$id" "$(basename "$d")"
    done < <(find "${top%/}" -maxdepth 4 -type d -path '*media/maps/*' -prune 2>/dev/null)
  done
}

# map folders provided by ACTIVE mods, in Mods= load order (deduped)
maps_available_for_active() {
  local tbl mid
  tbl="$(mods_map_table)"
  [ -z "$tbl" ] && return 0
  local IFS=';'
  for mid in $(mods_get); do
    unset IFS
    [ -n "$mid" ] && printf '%s\n' "$tbl" | awk -F'\t' -v id="$mid" '$1==id{print $2}'
    IFS=';'
  done | awk 'NF && !s[$0]++'
}

# append any active-mod maps missing from Map= (kept before the base map);
# echoes how many were added
maps_append_missing() {
  local cur added=0 m
  cur="$(map_get)"; [ -z "$cur" ] && cur="$PZ_BASEMAP"
  printf ';%s;' "$cur" | grep -qF ";$PZ_BASEMAP;" || cur="$cur;$PZ_BASEMAP"
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    [ "$m" = "$PZ_BASEMAP" ] && continue
    printf ';%s;' "$cur" | grep -qF ";$m;" && continue
    if [ "$cur" = "$PZ_BASEMAP" ]; then cur="$m;$PZ_BASEMAP"
    else cur="${cur%;$PZ_BASEMAP};$m;$PZ_BASEMAP"; fi
    added=$((added+1))
  done < <(maps_available_for_active)
  [ "$added" -gt 0 ] && map_set "$cur"
  echo "$added"
}

# rebuild Map= purely from active mods (load order), base map last; echoes the line
maps_rebuild() {
  local line="" m
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    [ "$m" = "$PZ_BASEMAP" ] && continue
    line="${line:+$line;}$m"
  done < <(maps_available_for_active)
  line="${line:+$line;}$PZ_BASEMAP"
  map_set "$line"
  printf '%s\n' "$line"
}

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
# Returns non-zero when the API is unreachable, so callers can tell "everything
# is current" apart from "could not check".
ws_details() {
  [ $# -eq 0 ] && return 0
  local data="itemcount=$#" i=0 id out
  for id in "$@"; do data="$data&publishedfileids%5B$i%5D=$id"; i=$((i+1)); done
  out="$(curl -fs --max-time 25 -X POST -d "$data" \
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/?format=json' 2>/dev/null)" || return 1
  [ -n "$out" ] || return 1
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
# collection manifest: <collection_id>\t<title>. Preserve the source collection separately from
# its resolved Workshop children so the control plane can present one canonical Steam link.
collection_set() {
  mkdir -p "$PZ_MODS"; [ -f "$PZ_COLLECTIONS" ] || touch "$PZ_COLLECTIONS"
  C="$1" N="$2" awk -F'\t' 'BEGIN { OFS="\t"; done=0 }
    $1==ENVIRON["C"] { print ENVIRON["C"], ENVIRON["N"]; done=1; next }
    NF { print }
    END { if (!done) print ENVIRON["C"], ENVIRON["N"] }' "$PZ_COLLECTIONS" > "$PZ_COLLECTIONS.pztmp" &&
    mv "$PZ_COLLECTIONS.pztmp" "$PZ_COLLECTIONS"
  fix_owner "$PZ_COLLECTIONS"
}

# Download ONE workshop item and install every mod inside it as a LOCAL mod.
# Echoes one installed mod id per line; returns non-zero if the download failed.
# Also records/updates the item in the workshop manifest (for update checking).
# Optional $2/$3 = time_updated/title already fetched by the caller (saves an API
# call per item when installing collections).
# Mods the user has disabled keep their files refreshed but are NOT re-added to
# Mods= — re-adding a collection must not undo disable choices (or duplicate the
# entry across the active and disabled lists).
install_workshop_item() {
  local wid="$1" ltime="${2:-}" ltitle="${3:-}"
  local tmp modsdir root info mid; local -a roots=() mids=()
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
    mod_disabled "$mid" || mods_append "$mid"
    mids+=("$mid")
    printf '%s\n' "$mid"
  done
  rm -rf "$tmp"
  [ ${#mids[@]} -eq 0 ] && return 1
  # record in the manifest so pz-modupdate can watch this item for updates
  if [ -z "$ltime" ]; then
    local det
    det="$(ws_details "$wid" | head -1)"
    ltime="$(printf '%s' "$det" | cut -f2)"; ltitle="$(printf '%s' "$det" | cut -f3)"
  fi
  manifest_set "$wid" "${ltime:-0}" "$(IFS=,; echo "${mids[*]}")" "${ltitle:-?}"
  return 0
}

# ------------------------------------------------------------ RCON
rcon_ready() { [ -n "$(ini_get RCONPassword)" ]; }
rcon_cmd_quick() {  # bounded read-only telemetry path; no retry
  local port pw
  port="$(ini_get RCONPort)"; port="${port:-$PZ_RCONPORT}"
  pw="$(ini_get RCONPassword)"
  [ -z "$pw" ] && return 3
  RCON_PASSWORD="$pw" timeout --signal=TERM --kill-after=1s 2s \
    python3 "$PZ_RCON" --host 127.0.0.1 --port "$port" --timeout 2 -- "$1" 2>/dev/null
}
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
  local -a paths=()
  [ -e "$srv" ] && paths+=("${srv#/}")
  [ -e "$sav" ] && paths+=("${sav#/}")
  [ "${#paths[@]}" -gt 0 ] || return 1
  ts="$(date +%Y%m%d_%H%M%S)"; mkdir -p "$dir"
  fix_owner "$dir"
  out="$dir/${prefix}_$ts.tar.gz"
  # tar from / so this works no matter where the cachedir lives.
  as_user tar czf "$out" -C / "${paths[@]}" 2>/dev/null || {
    rm -f "$out"
    return 1
  }
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
