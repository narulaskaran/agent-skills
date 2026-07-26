# Stacktr.ee OAuth Device Code Endpoints

## Device Code Request

```
POST https://api.stacktr.ee/device/code
Content-Type: application/json

{
  "client_id": "cli"
}
```

**Response (200):**
```json
{
  "device_code": "R8BE-EDVR",
  "user_code": "R8BE-EDVR",
  "verification_uri": "https://app.stacktr.ee/connect/cli",
  "expires_in": 600
}
```

## Authorization URL (user-facing)

```
https://app.stacktr.ee/connect/cli?code={user_code}
```

User opens this in browser, verifies code matches, clicks Authorize.

## Token Polling

```
POST https://api.stacktr.ee/device/token
Content-Type: application/json

{
  "device_code": "{device_code}",
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "client_id": "cli"
}
```

**Pending (400):**
```json
{"error": "authorization_pending"}
```

**Success (200):**
```json
{
  "access_token": "stk_live_...",
  "token_type": "bearer"
}
```

## API Key Creation

```
POST https://api.stacktr.ee/api-keys
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "name": "hermes-mcp"
}
```

**Response (200):**
```json
{
  "key": "stk_live_...",
  "name": "hermes-mcp",
  "created_at": "2026-06-26T..."
}
```
