---
name: mpp-payments
description: Reusable patterns for Machine Payment Protocol (MPP) payments via Stripe SPT (Link CLI) and Tempo (on-chain stablecoins via mppx). Use when making autonomous payments to any MPP-enabled merchant (PostalForm, demo sites, or others).
version: 1.0.0
---

# MPP Payment Protocol — Universal Patterns

Hard-won patterns for autonomous agent payments via the Machine Payment Protocol (x402/MPP).

MPP supports multiple payment **methods** — the `www-authenticate` header's `method` field tells you which one. The two methods encountered so far:

| Method | Payment Rail | Tooling | Auth Model |
|--------|-------------|---------|------------|
| `stripe` | Stripe SPT (fiat card-backed) | Link CLI (`@stripe/link-cli`) | Spend-request → user approval → SPT token |
| `tempo` | Tempo (on-chain stablecoins) | `mppx` CLI | Wallet private key signs challenge |

**Always check the `method` field first** — it determines the entire payment flow. The universal skeleton is the same (402 → extract challenge → pay → retry with credential), but the payment step diverges completely.

### Tempo Challenge Format

The `request` field in a Tempo `www-authenticate` header is base64-encoded JSON. Decode it to see payment details:

```json
{
    "amount": "10000",        // micro-units (10000 = 0.01 USDC)
    "currency": "0x20c0...",  // on-chain token address
    "methodDetails": {
        "chainId": 42431      // EVM chain ID
    },
    "recipient": "0xd696..."  // destination wallet
}
```

See `references/tempo-challenge-format.md` for a full decoded example.

## The MPP Flow — Stripe SPT

```
1. POST payload → 402 Payment Required
2. Extract www-authenticate header (method="stripe")
3. Decode challenge → network_id, amount, externalId
4. Create spend-request → user approves → get SPT
5. Serialize credential (challenge + SPT) → Authorization header
6. Retry POST with Authorization → 202 settlement
```

## The MPP Flow — Tempo (On-Chain)

```
1. GET/POST → 402 Payment Required
2. Extract www-authenticate header (method="tempo")
3. Base64-decode request field → amount, currency, chainId, recipient
4. mppx sign challenge → Authorization header (requires funded wallet)
5. Retry request with Authorization → 200 OK + Payment-Receipt
```

Or use `npx mppx <url>` which handles steps 1-5 automatically (requires account setup with funded wallet).

## Critical Rules (Universal)

### Single-Use Tokens
SPTs are single-use. One SPT pays exactly one order. Attempting reuse across orders fails with "Stripe PaymentIntent failed" or "Verification Failed."

**Pattern:** For N payments, create N spend-requests → user approves N times → use each SPT exactly once.

### Challenge Scoping
SPTs are cryptographically scoped to a specific challenge (id, externalId, network_id, amount). A challenge expires (usually within minutes to hours). An expired challenge cannot be paid with any SPT.

**Pattern:** Always use a fresh challenge (fresh 402 response) paired with a fresh SPT.

### Rate Limiting
MPP-enabled merchants often rate-limit unpaid order attempts. Each 402 response counts as an attempt. ~5+ unpaid attempts triggers 429.

**Pattern:** Space payments ≥1 hour apart. Never batch-submit. Completed payments clear the counter.

### ARG_MAX Avoidance
Shell argument limit (~2MB on Linux) breaks any CLI tool that accepts inline data. Always use file-based transfer.

```bash
# ❌ ARG_MAX risk
npx link-cli mpp pay --data "$LARGE_JSON"

# ✅ Safe
curl -s -d @payload.json <endpoint>
```

### Base64 vs Upload Tokens
If the merchant supports both upload tokens and base64 data URLs for file uploads:
- Upload tokens: single-use, consumed on first request (even a 402)
- Base64 data URLs: reusable across retries, no consumption

**Always prefer base64 data URLs** when payload size permits (compressed PDFs <300KB work).

## Link CLI Patterns

### Spend-Request Creation
```bash
npx -y @stripe/link-cli spend-request create \
  --paymentMethodId pm_visa_xxxxxxxxxxxx \
  --credentialType shared_payment_token \
  --networkId <network_id> \
  --amount <cents> --currency usd \
  --context "<100+ CHAR CONTEXT REQUIRED>" \
  --lineItem "name:<item>,unit_amount:<cents>,quantity:1" \
  --total "type:total,display_text:Total,amount:<cents>" \
  --requestApproval --format json
```

**Pitfalls:**
- `--context` MUST be ≥100 characters (VALIDATION_ERROR otherwise)
- Always use `--requestApproval` for user-facing flows
- Without `--requestApproval`, spend-request stays `pending_approval` with no notification

### Background Polling
```bash
npx -y @stripe/link-cli spend-request retrieve <lsrq_id> \
  --interval 3 --max-attempts 200 --format json
```

Use `terminal(background=true, notify_on_complete=true)` for async polling. Don't block the main conversation.

### Extracting SPT from Approved Request
```bash
npx -y @stripe/link-cli spend-request retrieve <lsrq_id> \
  --full-output --format json
```
SPT is at `data[last].shared_payment_token.id`.

### MPP Pay (Limited Use)
`link-cli mpp pay` does a 2-step flow: send payload → get 402 → retry. If the payload contains single-use resources (upload tokens), step 1 consumes them and step 2 fails.

**Prefer manual mppx serialization** when payload contains single-use resources.

### mppx Serialization
```bash
npm install mppx --silent
```

```javascript
// mppx_gen.js — takes challenge header + SPT, outputs Authorization header
const { Challenge, Credential } = require('mppx');
const mockResponse = {
  status: 402,
  headers: new Map([['WWW-Authenticate', process.argv[2]]])
};
const challenges = Challenge.fromResponseList(mockResponse);
const c = challenges.find(ch => ch.method === 'stripe');
console.log(Credential.serialize(Credential.from({
  challenge: c, payload: { spt: process.argv[3] }
})));
```

Usage:
```bash
AUTH=$(node mppx_gen.js "$STRIPE_CHALLENGE" "$SPT_TOKEN")
curl -s -H "Authorization: $AUTH" -d @payload.json <endpoint>
```

## Payment Method Reference

the user's Link payment methods (use `--paymentMethodId` to override default Visa):

| ID | Type | Name | Last4 |
|----|------|------|-------|
| `pm_visa_xxxxxxxxxxxx` | CARD | Visa Credit | 1234 (default) |
| `pm_mc_xxxxxxxxxxxx` | CARD | Bilt World Elite Mastercard | 5678 |
| `pm_alaska_xxxxxxxxxxxx` | CARD | Alaska Airlines | 0000 |

## Verification

After payment, always verify settlement:
```bash
curl -s "<order_endpoint>/<order_id>" | python3 -m json.tool
```
Look for: `"is_paid": true`, `"status": "payment_settled"`.

## Autonomous Payment Script

The `postalform-mailing` skill includes `scripts/pay_with_base64.py` — a reusable
Python script that handles the full flow: base64 encode PDF → POST → extract 402
challenge → mppx serialize → retry with auth. Load that skill for the script.

## Anti-Patterns

1. ❌ Reusing SPTs across multiple orders
2. ❌ Passing large payloads as CLI arguments
3. ❌ Creating >5 unpaid orders without spacing
4. ❌ Using upload tokens when base64 works
5. ❌ Forgetting `--requestApproval` on spend-requests
6. ❌ Context field under 100 characters
7. ❌ Using `link-cli mpp pay` with single-use tokens in payload
8. ❌ Not verifying settlement after payment
9. ❌ Assuming pre-approved SPTs are still valid. SPTs can expire or be consumed — "Stripe PaymentIntent failed" after correct mppx serialization means the SPT is dead. Create a fresh spend-request.
