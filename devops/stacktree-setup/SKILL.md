---
name: stacktree-setup
description: Set up Stacktr.ee MCP integration with Hermes. Works around the npx installer's TTY requirement by replicating the device-code OAuth flow manually via browser + API.
---

# Stacktr.ee Setup (MCP Integration)

Use when: setting up Stacktr.ee MCP tools for Hermes, or when `npx stacktree-install` fails due to TTY requirements.

## Triggers
- User asks to set up Stacktr.ee account/integration
- `npx stacktree-install` exits with "no TTY" or exit code 1
- Stacktr.ee MCP tools missing from Hermes

## The Problem

`npx stacktree-install` uses `@clack/prompts` for interactive TTY prompts. It fails in Hermes' terminal (no real TTY). All workarounds (script, pty, background process) fail because clack requires direct terminal interaction.

## Solution: Manual Device Code Flow

The installer internally does: request device code → show user URL → user authorizes → poll for API key → save config. Replicate this manually.

### Step 1: Get a device code

```bash
curl -s -X POST https://api.stacktr.ee/device/code \
  -H "Content-Type: application/json" \
  -d '{"client_id": "cli"}'
```

Returns: `{"device_code": "XXXX-XXXX", "user_code": "XXXX-XXXX", "verification_uri": "https://app.stacktr.ee/connect/cli", "expires_in": 600}`

### Step 2: Give user the authorization link

Tell the user: **https://app.stacktr.ee/connect/cli?code=XXXX-XXXX**

The user opens this in their browser, verifies the code matches, and clicks Authorize.

### Step 3: Poll for the API key

```bash
curl -s -X POST https://api.stacktr.ee/device/token \
  -H "Content-Type: application/json" \
  -d '{"device_code": "XXXX-XXXX", "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "client_id": "cli"}'
```

While the user hasn't authorized: returns `{"error": "authorization_pending"}`.
After authorization: returns `{"access_token": "stk_live_...", "token_type": "bearer"}`.

Poll every 2 seconds. Token expires in 10 minutes.

### Step 4: Generate an API key from the access token

```bash
curl -s -X POST https://api.stacktr.ee/api-keys \
  -H "Authorization: Bearer stk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "hermes-mcp"}'
```

Returns: `{"key": "stk_live_...", "name": "hermes-mcp", "created_at": "..."}`

### Step 5: Register the API key with Hermes

Use `hermes mcp add` or write directly to the MCP config. The key enables 9 tools: publish_html, update_site, delete_site, list_sites, get_site, set_password, set_expiry, set_agentation, set_email_gate.

## Full Flow Script

See `scripts/stacktree-oauth.sh` for a self-contained polling script.

## Pitfalls

- **Device code expires in 10 minutes.** If the user doesn't authorize in time, start over from Step 1.
- **`authorization_pending` is expected.** Keep polling — it means the user hasn't clicked Authorize yet. Only stop on timeout or a non-pending error.
- **Browser auth requires the user to already have a Stacktr.ee account.** If they don't, they need to sign up first (GitHub/Google OAuth on stacktr.ee).
- **API key from Step 4 is different from the access token from Step 3.** The access token is a short-lived OAuth bearer token. The API key is a permanent key for MCP.
- **Gateway restart required.** MCP tools become available after restarting the Hermes gateway. Warn the user their session will reconnect.

## Verification

After setup, run `hermes tools list | grep stacktree` to confirm the 9 MCP tools are registered.

## References

- `references/device-code-endpoints.md`: API endpoint reference
