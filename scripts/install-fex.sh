#!/usr/bin/env bash
# Install a pinned FEX build and an x86-64 RootFS for the ARM64 Zomboid runtime.
#
# This intentionally builds FEX from a commit instead of installing the moving apt
# package: FEX-2506 introduced a Project Zomboid regression, while a08a6ce is the
# known-good commit used by the Oracle Ampere reference setup.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "install-fex.sh must run as root" >&2; exit 1; }

TARGET_USER="${PZ_USER:-${SUDO_USER:-ubuntu}}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[ -n "$TARGET_HOME" ] || { echo "User '$TARGET_USER' does not exist" >&2; exit 1; }

FEX_COMMIT="${PZ_FEX_COMMIT:-a08a6ce5de51f5e625357ecaed46c463aa1e3c99}"
FEX_PREFIX="${PZ_FEX_PREFIX:-/opt/fex-a08}"
FEX_ROOTFS="${PZ_FEX_ROOTFS:-$TARGET_HOME/.local/share/fex-emu/RootFS/Ubuntu_24_04.sqsh}"
FEX_SOURCE="${PZ_FEX_SOURCE:-/var/cache/zomboid-arm/fex-$FEX_COMMIT}"
FEX_JOBS="${PZ_FEX_JOBS:-2}"

say() { printf '\033[1;32m>> FEX\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mFEX ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

marker="$FEX_PREFIX/.zomboid-fex-commit"
if [ -x "$FEX_PREFIX/bin/FEXLoader" ] && [ -f "$marker" ] &&
   [ "$(cat "$marker")" = "$FEX_COMMIT" ]; then
  say "Pinned FEX already installed at $FEX_PREFIX"
else
  say "Installing FEX build dependencies"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq \
    git cmake ninja-build pkgconf ccache clang llvm lld libssl-dev \
    squashfs-tools squashfuse g++-x86-64-linux-gnu >/dev/null

  mkdir -p "$(dirname "$FEX_SOURCE")"
  if [ ! -d "$FEX_SOURCE/.git" ]; then
    rm -rf "$FEX_SOURCE"
    mkdir -p "$FEX_SOURCE"
    git -C "$FEX_SOURCE" init -q
    git -C "$FEX_SOURCE" remote add origin https://github.com/FEX-Emu/FEX.git
  fi

  say "Fetching FEX commit $FEX_COMMIT"
  git -C "$FEX_SOURCE" fetch --filter=blob:none --no-tags origin "$FEX_COMMIT"
  git -C "$FEX_SOURCE" checkout -q "$FEX_COMMIT"
  git -C "$FEX_SOURCE" submodule update --init --recursive

  say "Building FEX with $FEX_JOBS jobs"
  rm -rf "$FEX_SOURCE/Build"
  cmake -S "$FEX_SOURCE" -B "$FEX_SOURCE/Build" -G Ninja \
    -DCMAKE_INSTALL_PREFIX="$FEX_PREFIX" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=clang \
    -DCMAKE_CXX_COMPILER=clang++ \
    -DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld \
    -DBUILD_TESTS=FALSE \
    -DBUILD_TESTING=FALSE \
    -DBUILD_FEX_LINUX_TESTS=FALSE \
    -DBUILD_THUNKS=FALSE \
    -DBUILD_FEXCONFIG=FALSE \
    -DENABLE_LTO=FALSE \
    -DENABLE_ASSERTIONS=FALSE \
    -DENABLE_CCACHE=TRUE \
    -DENABLE_OFFLINE_TELEMETRY=TRUE >/dev/null
  cmake --build "$FEX_SOURCE/Build" --parallel "$FEX_JOBS"
  cmake --install "$FEX_SOURCE/Build" >/dev/null
  printf '%s\n' "$FEX_COMMIT" > "$marker"
fi

[ -x "$FEX_PREFIX/bin/FEXLoader" ] || die "FEXLoader was not installed"

if [ ! -f "$FEX_ROOTFS" ]; then
  say "Downloading Ubuntu 24.04 x86-64 RootFS"
  install -d -o "$TARGET_USER" -g "$TARGET_USER" -m755 "$(dirname "$FEX_ROOTFS")"
  sudo -u "$TARGET_USER" env \
    HOME="$TARGET_HOME" \
    XDG_DATA_HOME="$TARGET_HOME/.local/share" \
    FEX_ROOTFS="$FEX_ROOTFS" \
    "$FEX_PREFIX/bin/FEXRootFSFetcher" -y -a \
      --distro-name=Ubuntu --distro-version=24.04
fi

[ -f "$FEX_ROOTFS" ] || die "RootFS not found at $FEX_ROOTFS (set PZ_FEX_ROOTFS to an existing squashfs image)"
chown "$TARGET_USER":"$TARGET_USER" "$FEX_ROOTFS" 2>/dev/null || true
say "Ready: commit=$FEX_COMMIT rootfs=$FEX_ROOTFS"
