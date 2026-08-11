#!/bin/bash
# Bring the server up through box64's flaky boot: restart, watch, and if it truly hangs,
# restart and try again. box64 boots succeed maybe 30-50% of the time on their own, so a
# few automated retries is the fast way to get to "listening".
#
#   success = UDP :16261 is listening (plus, optionally, a live Steam session)
#   hang    = console silent >2 min AND CPU idle over 8s   -> restart & retry
#   a box64 JIT SIGSEGV is FLAKY, so `Restart=always` reboots it and we keep trying.
#   Only a failed Workshop download (onItemNotDownloaded) is deterministic -> STOP (recrashes).
#
# PZ_REQUIRE_STEAM=1 (default when tcpdump is available): a box64 boot can reach
# "listening" with a DEAD Steam game-server session — the Steam networking thread
# wedges the same way boots hang. Players who join through Steam Relay can never
# reach such a server ("Getting Server Info" forever). With the gate on, after
# LISTENING we sample for traffic to Valve's ranges and count the boot as failed
# if none shows up, so it gets restarted like any other hung boot.
#
# Installed as /usr/local/sbin/pz-boot-retry ; also invoked by `pzctl` (menu: Start / Bring up).
SVC="${PZ_SERVICE:-zomboid-b42}"
PORT="${PZ_PORT:-16261}"
C="${PZ_CONSOLE:-/home/ubuntu/Zomboid/server-console.txt}"
CG=/sys/fs/cgroup/system.slice/$SVC.service/cpu.stat
REQ_STEAM="${PZ_REQUIRE_STEAM:-auto}"
if [ "$REQ_STEAM" = auto ]; then
  command -v tcpdump >/dev/null && REQ_STEAM=1 || REQ_STEAM=0
fi

# any packets to/from Valve ranges in a 25s window? (steam heartbeats are chatty)
steam_alive() {
  [ "$(sudo timeout 25 tcpdump -ni any 'net 162.254.0.0/16 or net 155.133.0.0/16 or net 205.196.0.0/16' -c 2 2>/dev/null | wc -l)" -gt 0 ]
}

for attempt in $(seq 1 6); do
  echo "=== ATTEMPT $attempt $(date -u +%H:%M:%S) ==="
  sudo systemctl restart "$SVC"
  for poll in $(seq 1 40); do
    sleep 15
    listen=$(sudo ss -uln 2>/dev/null | grep -cE ":$PORT\b")
    crash=$(grep -c "onItemNotDownloaded" "$C" 2>/dev/null)
    idle=$(( $(date +%s) - $(stat -c %Y "$C" 2>/dev/null || echo 0) ))
    last=$(tail -1 "$C" 2>/dev/null)
    echo "  [a$attempt p$poll] listen=$listen crash=$crash idle=${idle}s | ${last:0:40}"
    if [ "$listen" = "1" ]; then
      if [ "$REQ_STEAM" != 1 ]; then echo ">>> LISTENING OK (attempt $attempt) <<<"; exit 0; fi
      echo "  listening; verifying the Steam session (relay players need it)..."
      for s in $(seq 1 10); do
        if steam_alive; then echo ">>> LISTENING + STEAM OK (attempt $attempt) <<<"; exit 0; fi
        echo "  [a$attempt steam-check $s/10] no Valve traffic yet"
        sleep 5
      done
      echo "  >> listening but the Steam session is dead -> restart"
      break
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
