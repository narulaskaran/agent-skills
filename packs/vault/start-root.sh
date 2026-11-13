#!/usr/bin/env bash
# Runs as root at container start, before privileges drop to the nano user.
# Only the entrypoint may invoke this, and only for a pack under /app/packs.
set -euo pipefail

vault_uid=10001
vault_gid=10001
if [ "${NANO_UID:-1000}" = "$vault_uid" ]; then
  echo "nano-vault: NANO_UID collides with the vault user ($vault_uid); set NANO_UID to something else" >&2
  exit 1
fi
if ! id -u nano-vault >/dev/null 2>&1 || [ "$(id -u nano-vault)" != "$vault_uid" ]; then
  echo "nano-vault: user nano-vault (uid $vault_uid) is missing; rebuild the image" >&2
  exit 1
fi

vault_dir="${NANO_VAULT_DIR:-/vault}"
downloads="${NANO_VAULT_DOWNLOADS:-/var/lib/nano-vault/downloads}"
run_dir=/run/nano-vault
log="$vault_dir/daemon.log"

case "$downloads" in
  "$vault_dir"|"$vault_dir"/*)
    echo "nano-vault: downloads directory must not be inside $vault_dir" >&2
    exit 1
    ;;
esac
case "$downloads" in
  "${NANO_DATA_DIR:-/data}"|"${NANO_DATA_DIR:-/data}"/*)
    echo "nano-vault: downloads directory must not be inside the data directory" >&2
    exit 1
    ;;
esac

install -d -o "$vault_uid" -g "$vault_gid" -m 0700 "$vault_dir" "$vault_dir/tmp" "$vault_dir/xdg" "$vault_dir/cache"
install -d -o "$vault_uid" -g "$vault_gid" -m 0755 "$run_dir" "$(dirname "$downloads")" "$downloads"
touch "$log"
chown "$vault_uid:$vault_gid" "$log"
chmod 0600 "$log"

if ! mountpoint -q "$vault_dir"; then
  echo "nano-vault: warning: $vault_dir is not a mount point; saved credentials will be lost when the container is recreated" >&2
fi

# env -i so the daemon never inherits Nano's keys. The supervisor's own
# environment is this list and nothing else.
env -i \
  PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="$vault_dir" \
  TMPDIR="$vault_dir/tmp" \
  XDG_CONFIG_HOME="$vault_dir/xdg" \
  XDG_CACHE_HOME="$vault_dir/cache" \
  LANG="${LANG:-C.UTF-8}" \
  NANO_VAULT_DIR="$vault_dir" \
  NANO_VAULT_SOCKET="$run_dir/vault.sock" \
  NANO_VAULT_DOWNLOADS="$downloads" \
  NANO_VAULT_LOG="$log" \
  NANO_VAULT_UID="$vault_uid" \
  NANO_VAULT_GID="$vault_gid" \
  NANO_VAULT_BIND="${NANO_VAULT_BIND:-}" \
  NANO_VAULT_PORT="${NANO_VAULT_PORT:-}" \
  NANO_VAULT_ALLOW="${NANO_VAULT_ALLOW:-}" \
  NANO_VAULT_HOSTS="${NANO_VAULT_HOSTS:-}" \
  NANO_VAULT_INSECURE_ALLOW_LOCAL="${NANO_VAULT_INSECURE_ALLOW_LOCAL:-}" \
  NANO_VAULT_ALLOW_HTTP_LOOPBACK="${NANO_VAULT_ALLOW_HTTP_LOOPBACK:-}" \
  NANO_VAULT_INSECURE_TLS="${NANO_VAULT_INSECURE_TLS:-}" \
  NANO_BROWSER_IDLE_MINUTES="${NANO_BROWSER_IDLE_MINUTES:-}" \
  NANO_BROWSER_HOME="${NANO_BROWSER_HOME:-/opt/nano-browser}" \
  setsid -f /app/packs/vault/supervise.sh </dev/null >>"$log" 2>&1 &
echo "nano-vault: supervisor started"
