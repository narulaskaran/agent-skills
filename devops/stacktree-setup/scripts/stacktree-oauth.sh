#!/bin/bash
# stacktree-oauth.sh — Poll Stacktr.ee device code flow until authorized or expired
# Usage: ./stacktree-oauth.sh <device_code>
# Polls every 2 seconds, exits when token received or timeout (600s).

DEVICE_CODE="$1"
if [ -z "$DEVICE_CODE" ]; then
  echo "Usage: $0 <device_code>" >&2
  exit 1
fi

MAX_ATTEMPTS=300  # 600 seconds / 2 second interval
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  RESPONSE=$(curl -s -X POST https://api.stacktr.ee/device/token \
    -H "Content-Type: application/json" \
    -d "{\"device_code\": \"$DEVICE_CODE\", \"grant_type\": \"urn:ietf:params:oauth:grant-type:device_code\", \"client_id\": \"cli\"}")

  if echo "$RESPONSE" | grep -q "access_token"; then
    echo "$RESPONSE"
    exit 0
  fi

  if echo "$RESPONSE" | grep -q "authorization_pending"; then
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
    continue
  fi

  # Unexpected error
  echo "Error: $RESPONSE" >&2
  exit 1
done

echo "Timeout: device code expired" >&2
exit 1
