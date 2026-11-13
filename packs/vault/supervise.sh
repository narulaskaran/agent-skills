#!/usr/bin/env bash
# Restart loop for the vault daemon. The environment is already minimal:
# start-root.sh launches this with env -i.
set -u

log="${NANO_VAULT_LOG:-/vault/daemon.log}"
while true; do
  setpriv --reuid="${NANO_VAULT_UID}" --regid="${NANO_VAULT_GID}" --clear-groups --inh-caps=-all \
    python3 -c 'import ctypes, os, sys; ctypes.CDLL("libc.so.6").prctl(4, 0); os.execvp(sys.argv[1], sys.argv[1:])' \
    node /app/packs/vault/lib/daemon.mjs >>"$log" 2>&1 || true
  echo "nano-vault: daemon exited, restarting in 1s" >>"$log"
  sleep 1
done
