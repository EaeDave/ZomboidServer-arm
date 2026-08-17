#!/usr/bin/env bash
#
#  pz-modupdate — workshop mod update checker/applier for the PZ ARM server.
#
#    pz-modupdate check          human-readable report; exit 10 if updates exist
#    pz-modupdate check --ids    print outdated workshop ids only
#    pz-modupdate apply [--no-restart]
#                                backup world, re-download outdated items as local
#                                mods, log to the update log, restart the server
#    pz-modupdate auto           systemd-timer entrypoint; honors pzctl.conf:
#                                  MODUPDATE_AUTO=0|1        master switch
#                                  MODUPDATE_SCHED=daily|weekly
#                                  MODUPDATE_EMPTY_MIN=60    server empty this long
#                                  MODUPDATE_BACKUP_KEEP=2   backups kept (0-3, 0=off)
#
#  Runs fine as root (systemd timer) or as the game user (via pzctl).
#  Point PZCTL_ENV at an alternate env file to drive a non-default install.
#
set -uo pipefail
ENVF="${PZCTL_ENV:-/etc/zomboid-b42.env}"
export PZCTL_ENV="$ENVF"
[ -f "$ENVF" ] && . "$ENVF"
. "${PZ_COMMON:-/usr/local/lib/zomboid-arm/common.sh}"
pz_load_env

STATE="$PZ_CACHEDIR/.modupdate-state"
state_get() { ini_get "$1" "$STATE"; }
state_set() { ini_set "$1" "$2" "$STATE"; fix_owner "$STATE"; }

# one line per outdated item: <wid>\t<stored>\t<live>\t<title>
# returns 75 when the Steam API could not be reached (unknown state, not "all current")
outdated_rows() {
  local -a ids=(); local wid live title row stored det
  mapfile -t ids < <(manifest_ids)
  [ ${#ids[@]} -eq 0 ] && return 0
  det="$(ws_details "${ids[@]}")" || return 75
  while IFS=$'\t' read -r wid live title; do
    [ -z "$wid" ] && continue
    row="$(manifest_row "$wid")"; [ -z "$row" ] && continue
    stored="$(printf '%s' "$row" | cut -f2)"
    if [ "$live" -gt "${stored:-0}" ] 2>/dev/null; then
      printf '%s\t%s\t%s\t%s\n' "$wid" "${stored:-0}" "$live" "$title"
    fi
  done <<< "$det"
}

fmt_t() { date -d "@$1" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "$1"; }

emit_check_json() {
  MODUPDATE_STATUS="$1" \
  MODUPDATE_TRACKED="$2" \
  MODUPDATE_ROWS="${3:-}" \
  MODUPDATE_MESSAGE="${4:-}" \
  MODUPDATE_CHECKED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  python3 - <<'PY'
import json
import os

updates = []
for line in os.environ.get("MODUPDATE_ROWS", "").splitlines():
    parts = line.split("\t", 3)
    if len(parts) != 4:
        continue
    try:
        stored = max(0, int(parts[1]))
        available = max(0, int(parts[2]))
    except ValueError:
        continue
    updates.append({
        "workshopId": parts[0],
        "title": parts[3][:256],
        "storedUpdatedAt": stored,
        "availableUpdatedAt": available,
    })
result = {
    "status": os.environ["MODUPDATE_STATUS"],
    "checkedAt": os.environ["MODUPDATE_CHECKED_AT"],
    "trackedCount": max(0, int(os.environ.get("MODUPDATE_TRACKED", "0"))),
    "updates": updates[:1000],
}
message = os.environ.get("MODUPDATE_MESSAGE", "")
if message:
    result["message"] = message[:512]
print(json.dumps(result, separators=(",", ":")))
PY
}

emit_apply_json() {
  MODUPDATE_STATUS="$1" \
  MODUPDATE_UPDATED="${2:-}" \
  MODUPDATE_FAILED="${3:-}" \
  MODUPDATE_BACKUP_PATH="${4:-}" \
  MODUPDATE_RESTART_REQUESTED="$5" \
  MODUPDATE_RESTARTED="$6" \
  MODUPDATE_PLAYER_COUNT="${7:--1}" \
  MODUPDATE_MESSAGE="${8:-}" \
  python3 - <<'PY'
import json
import os


def items(value):
    result = []
    for line in value.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            result.append({"workshopId": parts[0], "title": parts[1][:256]})
    return result[:1000]

player_count = os.environ.get("MODUPDATE_PLAYER_COUNT", "-1")
try:
    parsed_player_count = int(player_count)
except ValueError:
    parsed_player_count = -1
result = {
    "status": os.environ["MODUPDATE_STATUS"],
    "updated": items(os.environ.get("MODUPDATE_UPDATED", "")),
    "failed": items(os.environ.get("MODUPDATE_FAILED", "")),
    "backupCreated": bool(os.environ.get("MODUPDATE_BACKUP_PATH", "")),
    "backupPath": os.environ.get("MODUPDATE_BACKUP_PATH", "") or None,
    "restartRequested": os.environ["MODUPDATE_RESTART_REQUESTED"] == "true",
    "restarted": os.environ["MODUPDATE_RESTARTED"] == "true",
    "playerCount": parsed_player_count if parsed_player_count >= 0 else None,
}
message = os.environ.get("MODUPDATE_MESSAGE", "")
if message:
    result["message"] = message[:512]
print(json.dumps(result, separators=(",", ":")))
PY
}

do_check() {
  local ids_only="" json_mode=0 arg
  for arg in "$@"; do
    case "$arg" in
      --ids) ids_only=--ids ;;
      --json) json_mode=1 ;;
    esac
  done
  local tracked; tracked="$(manifest_ids | grep -c . || true)"
  if [ "$tracked" -eq 0 ]; then
    if [ "$json_mode" = 1 ]; then
      emit_check_json no_tracked_mods 0 "" "No tracked Workshop items yet."
    elif [ "$ids_only" != --ids ]; then
      echo "No tracked mods yet. Mods added through pzctl are tracked automatically; re-add an existing mod/collection URL to start tracking it."
    fi
    return 0
  fi
  local raw
  if ! raw="$(outdated_rows)"; then
    if [ "$json_mode" = 1 ]; then
      emit_check_json unavailable "$tracked" "" "Steam API unreachable — try again later."
    elif [ "$ids_only" != --ids ]; then
      echo "Steam API unreachable — could not check for updates. Try again later."
    fi
    return 75
  fi
  local -a rows=()
  [ -n "$raw" ] && mapfile -t rows <<< "$raw"
  if [ "$json_mode" = 1 ]; then
    if [ ${#rows[@]} -eq 0 ]; then
      emit_check_json up_to_date "$tracked" ""
      return 0
    fi
    emit_check_json updates_available "$tracked" "$raw"
    return 10
  fi
  if [ "$ids_only" = --ids ]; then
    printf '%s\n' "${rows[@]}" 2>/dev/null | cut -f1 | grep . || true
    [ ${#rows[@]} -gt 0 ] && return 10 || return 0
  fi
  if [ ${#rows[@]} -eq 0 ]; then
    echo "All $tracked tracked workshop item(s) are up to date."
    return 0
  fi
  echo "Updates available for ${#rows[@]} item(s):"
  local wid stored live title
  while IFS=$'\t' read -r wid stored live title; do
    printf '  %-12s %s   (%s -> %s)\n' "$wid" "$title" "$(fmt_t "$stored")" "$(fmt_t "$live")"
  done < <(printf '%s\n' "${rows[@]}")
  return 10
}

do_apply() {
  local no_restart="" json_mode=0 require_empty=0 arg
  for arg in "$@"; do
    case "$arg" in
      --no-restart) no_restart=--no-restart ;;
      --json) json_mode=1 ;;
      --require-empty) require_empty=1 ;;
    esac
  done
  local json_fail_status=failed
  # lock lives in the cachedir, NOT /tmp: Ubuntu's fs.protected_regular blocks root
  # from opening another user's files in sticky world-writable dirs, and pz-modupdate
  # legitimately runs both as root (timer) and as the game user (pzctl).
  if ! { exec 9>"$PZ_CACHEDIR/.modupdate.lock"; } 2>/dev/null; then
    if [ "$json_mode" = 1 ]; then emit_apply_json "$json_fail_status" "" "" "" false false -1 "Cannot open the mod update lock."; return 0; fi
    echo "cannot open the update lock ($PZ_CACHEDIR/.modupdate.lock)"; return 75
  fi
  if ! flock -n 9; then
    if [ "$json_mode" = 1 ]; then emit_apply_json blocked "" "" "" false false -1 "Another update run is already in progress."; return 0; fi
    echo "another update run is in progress; skipping."; return 75
  fi
  fix_owner "$PZ_CACHEDIR/.modupdate.lock"

  local raw
  if ! raw="$(outdated_rows)"; then
    if [ "$json_mode" = 1 ]; then emit_apply_json unavailable "" "" "" "$([ -z "$no_restart" ] && echo true || echo false)" false -1 "Steam API unreachable — cannot verify what needs updating."; return 0; fi
    echo "Steam API unreachable — cannot verify what needs updating."; return 75
  fi
  local -a rows=()
  [ -n "$raw" ] && mapfile -t rows <<< "$raw"
  if [ ${#rows[@]} -eq 0 ]; then
    if [ "$json_mode" = 1 ]; then emit_apply_json up_to_date "" "" "" "$([ -z "$no_restart" ] && echo true || echo false)" false -1 "Nothing to update."; return 0; fi
    echo "Nothing to update."; return 0
  fi

  local current_players=-1
  if [ "$require_empty" = 1 ] && svc_active; then
    current_players="$(player_count)"
    if [ "$current_players" -lt 0 ] 2>/dev/null; then
      if [ "$json_mode" = 1 ]; then emit_apply_json blocked "" "" "" "$([ -z "$no_restart" ] && echo true || echo false)" false -1 "Player count could not be verified; update was not started."; return 0; fi
      echo "Player count could not be verified; refusing to update while the server is running."; return 75
    fi
    if [ "$current_players" -gt 0 ]; then
      if [ "$json_mode" = 1 ]; then emit_apply_json blocked "" "" "" "$([ -z "$no_restart" ] && echo true || echo false)" false "$current_players" "The server has players online; wait until it is empty or disable the empty-server guard."; return 0; fi
      echo "The server has players online; refusing to update while the empty-server guard is enabled."; return 75
    fi
  fi

  local keep backup_path=""
  keep="$(conf_get MODUPDATE_BACKUP_KEEP 2)"
  [[ "$keep" =~ ^[0-3]$ ]] || keep=2
  if [ "$keep" = 0 ]; then
    [ "$json_mode" = 1 ] || echo "Pre-update world backup disabled (backups kept = 0)."
  else
    [ "$json_mode" = 1 ] || echo "Backing up world before updating (${#rows[@]} item(s))..."
    if ! backup_path="$(backup_world "$PZ_BACKUPS/mod-update" modup)"; then
      if [ "$json_mode" = 1 ]; then emit_apply_json failed "" "" "" "$([ -z "$no_restart" ] && echo true || echo false)" false "$current_players" "Could not create the pre-update world backup."; return 0; fi
      echo "Could not create the pre-update world backup."; return 75
    fi
    rotate_backups "$PZ_BACKUPS/mod-update" modup "$keep"
  fi

  local wid stored live title ok=0 fail=0 updated_rows="" failed_rows=""
  while IFS=$'\t' read -r wid stored live title; do
    if [ "$json_mode" = 1 ]; then :; else printf '  updating %s (%s) ... ' "$title" "$wid"; fi
    if install_workshop_item "$wid" >/dev/null; then
      ok=$((ok+1)); [ "$json_mode" = 1 ] || echo "ok"
      updated_rows+="${wid}"$'\t'"${title}"$'\n'
      log_modupdate "updated | $wid | $title | $(fmt_t "$stored") -> $(fmt_t "$live")"
    else
      fail=$((fail+1)); [ "$json_mode" = 1 ] || echo "FAILED (kept previous files)"
      failed_rows+="${wid}"$'\t'"${title}"$'\n'
      log_modupdate "FAILED  | $wid | $title | download error, previous version kept"
    fi
  done < <(printf '%s\n' "${rows[@]}")
  [ "$json_mode" = 1 ] || echo "Done: $ok updated, $fail failed. Log: $PZ_UPDATELOG"

  local restarted=false restart_rc=0 restart_requested=true
  [ -n "$no_restart" ] && restart_requested=false
  if [ "$no_restart" = --no-restart ]; then
    [ "$json_mode" = 1 ] || echo "Restart skipped (caller handles it)."
  elif ! svc_active; then
    [ "$json_mode" = 1 ] || echo "Server is stopped; updated files will load on the next start."
  else
    [ "$json_mode" = 1 ] || echo "Restarting the server to load updated mods..."
    if [ "$json_mode" = 1 ]; then
      if "$PZ_BOOTRETRY" >/dev/null 2>&1; then restarted=true; else restart_rc=$?; fi
    elif "$PZ_BOOTRETRY"; then
      restarted=true
    else
      restart_rc=$?
    fi
  fi
  if [ "$json_mode" = 1 ]; then
    local outcome=updated message=""
    [ "$fail" -gt 0 ] && outcome=partial && message="Some Workshop items could not be downloaded; previous files were kept."
    if [ "$restart_rc" -ne 0 ]; then outcome=failed; message="Mods were updated, but the server restart failed."; fi
    emit_apply_json "$outcome" "$updated_rows" "$failed_rows" "$backup_path" "$restart_requested" "$restarted" "$current_players" "$message"
    return 0
  fi
  [ "$fail" -eq 0 ] && [ "$restart_rc" -eq 0 ]
}

do_auto() {
  [ "$(conf_get MODUPDATE_AUTO 0)" = 1 ] || exit 0
  local now interval last pending empty_since count empty_min
  now="$(date +%s)"
  case "$(conf_get MODUPDATE_SCHED daily)" in
    weekly) interval=604800 ;;
    *)      interval=86400  ;;
  esac
  last="$(state_get LAST_CHECK)"; last="${last:-0}"

  if [ $((now - last)) -ge "$interval" ]; then
    pending="$(do_check --ids)"; rc=$?
    if [ "$rc" = 75 ]; then
      # API unreachable: do NOT burn the daily slot — retry on the next tick
      logger -t pz-modupdate "steam api unreachable during scheduled check; retrying next tick"
    else
      pending="$(printf '%s' "$pending" | tr '\n' ' ')"
      state_set LAST_CHECK "$now"
      state_set PENDING "${pending% }"
      if [ -n "${pending% }" ]; then
        logger -t pz-modupdate "check: updates pending for: ${pending% }"
        log_modupdate "check   | updates detected, waiting for an empty server"
      fi
    fi
  fi

  pending="$(state_get PENDING)"
  [ -z "$pending" ] && exit 0

  if ! svc_active; then
    logger -t pz-modupdate "server stopped; applying mod updates now"
    if do_apply --no-restart; then
      state_set PENDING ""; state_set EMPTY_SINCE ""
    fi                       # busy/failed -> keep PENDING, retry next tick
    exit 0
  fi

  count="$(player_count)"
  if [ "$count" = -1 ]; then
    logger -t pz-modupdate "cannot read player count (RCON off/unreachable); postponing mod updates"
    exit 0
  elif [ "$count" -gt 0 ]; then
    state_set EMPTY_SINCE ""
    exit 0
  fi

  empty_since="$(state_get EMPTY_SINCE)"
  if [ -z "$empty_since" ]; then
    state_set EMPTY_SINCE "$now"
    exit 0
  fi
  empty_min="$(conf_get MODUPDATE_EMPTY_MIN 60)"
  [[ "$empty_min" =~ ^[0-9]+$ ]] || empty_min=60
  if [ $((now - empty_since)) -ge $((empty_min * 60)) ]; then
    logger -t pz-modupdate "server empty for ${empty_min}m; applying mod updates"
    if do_apply; then
      state_set PENDING ""; state_set EMPTY_SINCE ""
    fi                       # busy/failed -> keep PENDING, retry next tick
  fi
}

case "${1:-}" in
  check) shift; do_check "$@" ;;
  apply) shift; do_apply "$@" ;;
  auto)  do_auto ;;
  *) sed -n '2,18p' "$0" | sed 's/^#//;s/^ //'; exit 1 ;;
esac
