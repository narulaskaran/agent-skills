#!/usr/bin/env bash
set -euo pipefail
apt-get update
apt-get install -y --no-install-recommends ffmpeg
rm -rf /var/lib/apt/lists/*
chmod 755 "$(dirname "$0")/bin/nano-speech"
