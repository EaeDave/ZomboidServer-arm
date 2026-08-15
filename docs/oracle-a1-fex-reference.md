# Tested reference: Oracle Ampere A1 + FEX

The FEX runtime in this fork is not an untested generic ARM claim. The working
reference setup was validated end-to-end on:

- **Cloud:** Oracle Cloud Infrastructure
- **Shape:** `VM.Standard.A1.Flex`
- **CPU:** 4 OCPUs, ARM64 Ampere / Neoverse-N1
- **Memory:** 24 GiB RAM, with a 4 GiB swapfile
- **OS:** Ubuntu 24.04 LTS, `aarch64`
- **Game:** Project Zomboid dedicated server Build 42.20.2
- **Java:** the bundled Zulu/OpenJDK 25 x86-64 JVM
- **FEX:** commit `a08a6ce5de51f5e625357ecaed46c463aa1e3c99`, before the
  FEX-2506 Project Zomboid JIT regression
- **FEX RootFS:** Ubuntu 24.04 x86-64 squashfs
- **Server memory:** `PZ_RAM_GB=10`
- **Runtime setting:** `FEX_MULTIBLOCK=0`
- **JVM settings:** `UseSerialGC`, `TieredStopAtLevel=1`,
  `-XX:-UseCompressedOops`, and the tested Project Zomboid exclusions

The server was tested with two external players. It reached `SERVER STARTED`,
accepted both Steam clients, and remained playable without noticeable latency.
For this Oracle/cloud-NAT setup, clients should enable **Use Steam Relay**.
The direct UDP `16262` warning may remain visible while Relay is in use; it does
not prevent a working session, but a direct route can have lower latency when it
is available.

## Reproducing the runtime

The installer defaults to the tested FEX backend:

```bash
sudo PZ_RUNTIME=fex ./install.sh
```

The commit, prefix, and RootFS can be overridden without changing the scripts:

```bash
sudo PZ_RUNTIME=fex \
  PZ_FEX_COMMIT=a08a6ce5de51f5e625357ecaed46c463aa1e3c99 \
  PZ_FEX_PREFIX=/opt/fex-a08 \
  PZ_FEX_ROOTFS=/home/ubuntu/.local/share/fex-emu/RootFS/Ubuntu_24_04.sqsh \
  ./install.sh
```

Use `PZ_RUNTIME=box64` to select the original Box64 path. FEX source, RootFS,
Project Zomboid files, worlds, passwords, and public IPs are deliberately not
stored in Git.
