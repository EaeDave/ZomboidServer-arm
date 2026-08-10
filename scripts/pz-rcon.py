#!/usr/bin/env python3
"""Minimal Source-RCON client for the Project Zomboid dedicated server.

Used by pzctl (admin console) and pz-modupdate (player count). Stdlib only.
The password is read from the RCON_PASSWORD environment variable so it never
shows up in `ps` output.

    RCON_PASSWORD=secret pz-rcon.py --host 127.0.0.1 --port 27015 -- players
"""
import argparse
import os
import socket
import struct
import sys

SERVERDATA_AUTH = 3
SERVERDATA_AUTH_RESPONSE = 2
SERVERDATA_EXECCOMMAND = 2


def send_packet(sock, pid, ptype, body):
    data = struct.pack("<ii", pid, ptype) + body.encode("utf-8") + b"\x00\x00"
    sock.sendall(struct.pack("<i", len(data)) + data)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed by server")
        buf += chunk
    return buf


def recv_packet(sock):
    (length,) = struct.unpack("<i", recv_exact(sock, 4))
    data = recv_exact(sock, length)
    pid, ptype = struct.unpack("<ii", data[:8])
    body = data[8:-2].decode("utf-8", "replace")
    return pid, ptype, body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=27015)
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("command", nargs="+", help="command to execute")
    args = ap.parse_args()

    password = os.environ.get("RCON_PASSWORD", "")
    if not password:
        print("RCON_PASSWORD not set", file=sys.stderr)
        return 3

    command = " ".join(args.command)
    try:
        with socket.create_connection((args.host, args.port), timeout=args.timeout) as sock:
            sock.settimeout(args.timeout)
            send_packet(sock, 1, SERVERDATA_AUTH, password)
            # Some servers send an empty RESPONSE_VALUE before AUTH_RESPONSE.
            while True:
                pid, ptype, _ = recv_packet(sock)
                if ptype == SERVERDATA_AUTH_RESPONSE:
                    break
            if pid == -1:
                print("RCON auth failed (wrong password?)", file=sys.stderr)
                return 4

            send_packet(sock, 2, SERVERDATA_EXECCOMMAND, command)
            pid, ptype, body = recv_packet(sock)
            out = [body]
            # Drain any follow-up packets of a multi-packet response.
            sock.settimeout(0.5)
            try:
                while True:
                    _, _, more = recv_packet(sock)
                    out.append(more)
            except (socket.timeout, ConnectionError):
                pass
            text = "".join(out).rstrip("\n")
            if text:
                print(text)
            return 0
    except socket.timeout:
        print("RCON timeout (server booting or RCON disabled?)", file=sys.stderr)
        return 5
    except (ConnectionError, OSError) as exc:
        print(f"RCON connection failed: {exc}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main())
