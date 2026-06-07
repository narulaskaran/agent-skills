# Batch Order Handling — Rate Limits, Token Lifecycle, and Retry Patterns

## Critical Token Lifecycle

Upload tokens (`pfu_...`) are **single-use and consumed on ANY MPP request**, regardless of outcome:

| Response | Token Consumed? | Can Reuse request_id? | Recovery |
|----------|----------------|----------------------|----------|
| 402 (payment required) | ✅ YES | YES | Pay with fresh spend-request |
| 422 (invalid PDF/token) | ✅ YES | NO | New token + new request_id |
| 429 (rate limited) | ❌ Usually not | YES | Wait 1h, retry same payload |
| 202 (settled) | ✅ YES | N/A | Done |

### Failure Chain Pattern

The most common failure mode when retrying payments:

1. **Attempt 1**: `link-cli mpp pay` → 422 "token invalid/expired" (token consumed)
2. **Attempt 2**: Retry with same token → 422 "token already used. Order: <UUID>" (token burned)
3. **Root cause**: Token was consumed in step 1, or by a prior order creation attempt

**Every retry requires**: fresh `create_pdf_upload` + fresh `request_id` UUID + updated payload file.

## Rate Limit Recovery

PostalForm triggers 429 after **3-4 unpaid MPP orders within ~60 seconds**. The 429 blocks BOTH:
- New order creation (`POST /api/machine/mpp/orders`)
- Payment attempts (`link-cli mpp pay`)

**Recovery strategy:**
1. Wait 1 hour (minimum cooldown)
2. Re-upload ALL PDFs fresh (assume all tokens consumed)
3. Generate new `request_id` UUIDs for all orders
4. Update all payload files with new tokens + request_ids
5. Pay ONE at a time: `link-cli mpp pay` → verify 202 → next order
6. Only after 1 success, attempt remaining orders

**Cron-based retry pattern:**
- Space cron jobs 1 hour apart (one per card)
- Each cron: upload → order → spend-request → stop (don't poll beyond 2 min)
- Save state to recovery file: `{upload_token, request_id, spend_id, payload}`
- Next session/task picks up from state file

## Spend-Request Constraints

### Context field minimum length
The `--context` parameter in `spend-request create` must be **>=100 characters**. Shorter contexts return `VALIDATION_ERROR: "Too small: expected string to have >=100 characters"`.

Example failure: `"Abhinav postcard"` (19 chars) → ❌
Example success: `"PostalForm 4x6 Ghibli-style postcard for Abhinav mailed to 15903 Riverton Ave Lathrop CA 95330. Part of batch of 4 Mother's Day cards for friends."` (143 chars) → ✅

### Without --requestApproval
Omitting `--requestApproval` still creates a spend-request in `pending_approval` status — it just doesn't send a push notification. The user must still manually approve via Link app. There is no auto-approval path.

### Spend-request challenge scoping
Approved spend-requests (SPT tokens) are scoped to **specific challenges** (challenge ID + externalId embedded in base64 request). An SPT approved for challenge A **cannot** pay an order created with challenge B, even if amount/currency/network_id match. The server rejects with: `"Challenge <id> is invalid: challenge was not issued by this server."`

Old approved spend-requests become unusable when their challenge expires (typically within minutes of issuance).

## Parsing Multi-Header 402 Responses

PostalForm's 402 response often includes **two** `www-authenticate` headers:
1. `method="tempo"` — crypto (USDC) payment
2. `method="stripe"` — card/Link payment

Use `curl -D <file>` (NOT `-i`) to capture ALL headers. Then filter for `method="stripe"`:

```python
stripe_auth = None
for line in headers.split('\n'):
    if 'www-authenticate:' in line.lower() and 'method="stripe"' in line:
        stripe_auth = line.split(':', 1)[1].strip()
        break
```

Using `curl -i` or parsing only the first `www-authenticate` will miss the Stripe challenge if tempo comes first.

## Order Status Monitoring

Check existing order status (useful when investigating failed payments):
```bash
curl -s "https://postalform.com/api/machine/mpp/orders/<order_id>" | python3 -m json.tool
```

Key fields: `status` (awaiting_payment/paid), `is_paid`, `payment_intent_id`, `machine_payment.network`, `price_usd`.

An order in `awaiting_payment` status still exists — the upload token was consumed creating it, but it can be paid with the correct Authorization header.
