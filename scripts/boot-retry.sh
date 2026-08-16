#!/bin/bash
# Bring the server up through the selected ARM emulation runtime: restart, watch, and if it
# truly hangs, restart and try again. A few automated retries is the fast way to get to
# "listening" on a cold JVM boot.
#
#   success = UDP :16261 is listening (plus, optionally, a live Steam session)
#   hang    = console silent >2 min AND CPU idle over 8s   -> restart & retry
#   an emulation/JIT crash is treated as recoverable, so `Restart=always` reboots it.
#   Only a failed Workshop download (onItemNotDownloaded) is deterministic -> STOP (recrashes).
#
# Steam Relay remains required for clients on this Oracle/cloud-NAT deployment.  A passive
# packet sample is only supporting evidence, however: an idle server can have a healthy Steam
# session without sending packets during an arbitrary window.  PZ_STEAM_SESSION_CHECK defaults
# to observe, records that evidence, and never turns a listening server into a restart loop.
#
# Modes: observe (default, non-blocking telemetry), required (legacy strict behavior; opt-in),
# disabled (do not sample). PZ_REQUIRE_STEAM is mapped for backwards compatibility by common.sh.
#
# Installed as /usr/local/sbin/pz-boot-retry ; also invoked by `pzctl` (menu: Start / Bring up).
SVC="${PZ_SERVICE:-zomboid-b42}"
PORT="${PZ_PORT:-16261}"
C="${PZ_CONSOLE:-/home/ubuntu/Zomboid/server-console.txt}"
CG=/sys/fs/cgroup/system.slice/$SVC.service/cpu.stat
STEAM_CHECK="${PZ_STEAM_SESSION_CHECK:-observe}"
STEAM_STATUS="${PZ_STEAM_SESSION_STATUS:-$(dirname "$C")/pz-steam-session.json}"
STEAM_SAMPLE_SECONDS="${PZ_STEAM_SESSION_SAMPLE_SECONDS:-25}"
case "$STEAM_CHECK" in observe|required|disabled) ;; *) STEAM_CHECK=observe ;; esac
case "$STEAM_SAMPLE_SECONDS" in ''|*[!0-9]*) STEAM_SAMPLE_SECONDS=25 ;; esac
[ "$STEAM_SAMPLE_SECONDS" -ge 1 ] && [ "$STEAM_SAMPLE_SECONDS" -le 60 ] || STEAM_SAMPLE_SECONDS=25

steam_status() {
  local evidence="$1" message="$2" active_since tmp
  mkdir -p "$(dirname "$STEAM_STATUS")"
  tmp="$(mktemp "${STEAM_STATUS}.tmp.XXXXXX")" || return 1
  active_since="$(sudo systemctl show "$SVC" -p ActiveEnterTimestamp --value 2>/dev/null || true)"
  STEAM_MODE="$STEAM_CHECK" STEAM_EVIDENCE="$evidence" STEAM_MESSAGE="$message" \
    STEAM_ACTIVE_SINCE="$active_since" python3 - >"$tmp" <<'PY'
import json
import os
from datetime import datetime, timezone

print(json.dumps({
    "mode": os.environ["STEAM_MODE"],
    "evidence": os.environ["STEAM_EVIDENCE"],
    "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "message": os.environ["STEAM_MESSAGE"],
    "serviceActiveSince": os.environ["STEAM_ACTIVE_SINCE"],
}, separators=(",", ":")))
PY
  # This contains no credentials and must be readable by the unprivileged status probe.
  chmod 644 "$tmp"
  mv "$tmp" "$STEAM_STATUS"
}

# Passive traffic is evidence only. It cannot prove a Steam/Relay session is unavailable.
steam_evidence() {
  local capture packets rc
  if ! command -v tcpdump >/dev/null; then
    steam_status not_checked "tcpdump is unavailable; Relay telemetry was not sampled."
    return 2
  fi
  capture="$(mktemp)" || return 2
  if sudo timeout "$STEAM_SAMPLE_SECONDS" tcpdump -ni any \
    'net 162.254.0.0/16 or net 155.133.0.0/16 or net 205.196.0.0/16' -c 2 >"$capture" 2>/dev/null; then
    rc=0
  else
    rc=$?
  fi
  packets="$(wc -l < "$capture")"
  rm -f "$capture"
  if [ "$packets" -gt 0 ]; then
    steam_status observed "Valve-range traffic was observed after the server became ready."
    return 0
  fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 124 ]; then
    steam_status not_checked "Passive Relay telemetry capture failed; no conclusion was recorded."
    return 2
  fi
  steam_status not_observed "No Valve-range traffic was observed during the passive sample; this does not prove Relay is unavailable."
  return 1
}

for attempt in $(seq 1 6); do
  echo "=== ATTEMPT $attempt $(date -u +%H:%M:%S) ==="
  sudo systemctl restart "$SVC"
  steam_status not_checked "Waiting for this boot to become ready before collecting Relay telemetry."
  for poll in $(seq 1 40); do
    sleep 15
    listen=$(sudo ss -uln 2>/dev/null | grep -cE ":$PORT\b")
    crash=$(grep -c "onItemNotDownloaded" "$C" 2>/dev/null)
    idle=$(( $(date +%s) - $(stat -c %Y "$C" 2>/dev/null || echo 0) ))
    last=$(tail -1 "$C" 2>/dev/null)
    echo "  [a$attempt p$poll] listen=$listen crash=$crash idle=${idle}s | ${last:0:40}"
    if [ "$listen" = "1" ]; then
      case "$STEAM_CHECK" in
        disabled)
          steam_status not_checked "Relay telemetry is disabled by configuration."
          echo ">>> LISTENING OK (attempt $attempt; Relay telemetry disabled) <<<"
          exit 0
          ;;
        observe)
          if steam_evidence; then
            echo ">>> LISTENING OK (attempt $attempt; Relay telemetry observed) <<<"
          else
            echo ">>> LISTENING OK (attempt $attempt; Relay telemetry not observed, not blocking) <<<"
          fi
          exit 0
          ;;
        required)
          echo "  listening; strict Relay telemetry check enabled..."
          if steam_evidence; then
            echo ">>> LISTENING + RELAY TELEMETRY OK (attempt $attempt) <<<"
            exit 0
          fi
          echo "  >> Relay telemetry was not observed; strict mode will retry"
          break
          ;;
      esac
    fi
    [ "$crash" -ge 1 ] 2>/dev/null && { echo ">>> Workshop download failed — not retrying (deterministic). Check the mod. <<<"; exit 2; }
    if [ "$idle" -ge 120 ] 2>/dev/null; then
      u1=$(awk '/usage_usec/{print $2}' "$CG" 2>/dev/null); sleep 8; u2=$(awk '/usage_usec/{print $2}' "$CG" 2>/dev/null)
      d=$(( (u2 - u1)/1000000 ))
      echo "    (console ${idle}s static, cpu delta=${d}s)"
      [ "$d" -lt 2 ] 2>/dev/null && { echo "    >> HANG (cpu idle) -> restart"; break; }
    fi
  done
done
echo ">>> no healthy boot after 6 attempts <<<"; exit 1
