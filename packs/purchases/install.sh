#!/usr/bin/env bash
# Runs as root when the image is built. Adds:
# - Full Chromium via playwright-core, running in its current headless mode
# - the Stripe Link CLI
# Both are pinned: each ships breaking changes.
set -euo pipefail

PLAYWRIGHT_VERSION=1.65.0
LINK_CLI_VERSION=1.4.1
pack="$(cd "$(dirname "$0")" && pwd)"

apt-get update
apt-get install -y --no-install-recommends \
  fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
  libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
rm -rf /var/lib/apt/lists/*

npm install --prefix /opt/nano-browser --omit=dev --ignore-scripts --no-audit --no-fund "playwright-core@$PLAYWRIGHT_VERSION"
PLAYWRIGHT_BROWSERS_PATH=/opt/nano-browser/browsers /opt/nano-browser/node_modules/.bin/playwright-core install --no-shell chromium
# ffmpeg is only used for video recording.
rm -rf /opt/nano-browser/browsers/ffmpeg-*
chmod -R a+rX /opt/nano-browser

npm install --global --prefix /opt/link-cli --omit=dev --ignore-scripts --no-audit --no-fund "@stripe/link-cli@$LINK_CLI_VERSION"
# Type definitions, sourcemaps and docs are about half of its 157 MB (mostly viem); none are loaded at runtime.
find /opt/link-cli \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.md' -o -name _types -type d \) \
  -prune -exec rm -rf {} +

# Also reachable outside Nano's PATH, e.g. from `docker exec` or the Link validator.
chmod 755 "$pack/bin/"*
ln -sf "$pack/bin/link-cli" /usr/local/bin/link-cli
ln -sf "$pack/bin/browser" /usr/local/bin/browser
npm cache clean --force
