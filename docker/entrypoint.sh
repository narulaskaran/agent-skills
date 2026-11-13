#!/usr/bin/env bash
# Starts as root only to make the data directory writable, then drops to an
# unprivileged user. NANO_UID/NANO_GID let the files match a host user.
set -euo pipefail

uid="${NANO_UID:-1000}"
gid="${NANO_GID:-$uid}"
data="${NANO_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data/home"
  if [ "$(stat -c %u "$data")" != "$uid" ]; then
    chown -R "$uid:$gid" "$data"
  fi
  # A fresh install gets a starter knowledge base; an existing one is never touched.
  kb="${NANO_KB_DIR:-$data/kb}"
  if [ -d "$kb" ] && [ -z "$(ls -A "$kb")" ]; then
    cp -r /app/templates/kb/. "$kb/" && chown -R "$uid:$gid" "$kb"
  elif [ ! -e "$kb" ]; then
    mkdir -p "$kb" && cp -r /app/templates/kb/. "$kb/" && chown -R "$uid:$gid" "$kb"
  fi
  # Shipped packs may start a root helper before privileges drop. A pack under
  # the data directory is writable by the agent, so a start-root.sh there is ignored.
  IFS=',' read -ra pack_names <<< "${NANO_PACKS:-core}"
  for pack_name in "${pack_names[@]}"; do
    pack_name="${pack_name#"${pack_name%%[![:space:]]*}"}"
    pack_name="${pack_name%"${pack_name##*[![:space:]]}"}"
    case "$pack_name" in
      ""|*[!A-Za-z0-9_-]*) echo "nano: ignoring invalid pack name" >&2; continue ;;
    esac
    hook="/app/packs/${pack_name}/start-root.sh"
    if [ -x "$hook" ]; then
      echo "nano: starting ${pack_name}"
      "$hook"
    fi
  done
  export HOME="$data/home"
  groups="$gid${NANO_EXTRA_GROUPS:+,$NANO_EXTRA_GROUPS}"
  exec setpriv --reuid="$uid" --regid="$gid" --groups="$groups" "$@"
fi

export HOME="${HOME:-$data/home}"
exec "$@"
