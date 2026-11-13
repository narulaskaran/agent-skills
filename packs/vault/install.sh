#!/usr/bin/env bash
# Runs as root when the image is built. The vault user is a fixed uid so it
# cannot collide with a later choice of NANO_UID; start-root.sh checks that.
set -euo pipefail

uid=10001
gid=10001

apt-get update
apt-get install -y --no-install-recommends passwd
rm -rf /var/lib/apt/lists/*

if getent group nano-vault >/dev/null; then
  existing="$(getent group nano-vault | cut -d: -f3)"
  if [ "$existing" != "$gid" ]; then
    echo "nano-vault: group nano-vault has gid $existing, want $gid" >&2
    exit 1
  fi
else
  groupadd --system --gid "$gid" nano-vault
fi

if id nano-vault >/dev/null 2>&1; then
  existing="$(id -u nano-vault)"
  if [ "$existing" != "$uid" ]; then
    echo "nano-vault: user nano-vault has uid $existing, want $uid" >&2
    exit 1
  fi
else
  useradd --system --uid "$uid" --gid "$gid" --home-dir /vault --no-create-home --shell /usr/sbin/nologin nano-vault
fi

install -d -o "$uid" -g "$gid" -m 0700 /vault
chmod 755 "$(dirname "$0")/bin/"* "$(dirname "$0")/start-root.sh" "$(dirname "$0")/supervise.sh"
ln -sfn "$(dirname "$0")/bin/vault" /usr/local/bin/vault
