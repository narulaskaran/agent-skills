# MPP Payment Flows — Session Reference

## Link CLI + MPP Stripe SPT (Canonical Flow)

This is the flow that works for autonomous agent payment. Tested May 7, 2026.

### Architecture

```
PostalForm MPP order (402)
    → Stripe challenge (WWW-Authenticate: method=stripe)
        → Link CLI mpp decode → network_id
            → Link CLI spend-request (SPT) → user approves in Link app
                → Link CLI mpp pay → Authorization header
                    → Retry MPP order → 202 settled
```

### Why Not Direct Stripe API

PostalForm's Stripe publishable key is NOT accessible from their source (dynamically loaded from js.stripe.com). The Link CLI (`@stripe/link-cli`) handles the full SPT lifecycle without needing the merchant's Stripe key. Do NOT try to hunt for `pk_live_` in PostalForm's JS bundles — use the Link CLI path exclusively.

### Flow Details

#### 1. Create MPP order (small payload!)
Always use `upload_token` for the PDF — never inline base64 in the MPP order. Base64 PDFs (~350KB) hit shell ARG_MAX limits when passed as CLI arguments. The upload approach keeps the payload under 1KB.

```json
{
  "request_id": "<UUID>",
  "buyer_name": "Jane Doe",
  "buyer_email": "user@example.com",
  "mailpiece_type": "postcard",
  "postcard_size": "6x9",
  "pdf": {"upload_token": "pfu_..."},
  "sender_name": "Jane Doe",
  "sender_address_type": "Manual",
  "sender_address_manual": {"line1": "123 Main St", "line2": "Apt 1A", "city": "Anytown", "state": "ST", "zip": "12345"},
  "recipient_name": "Jane Smith",
  "recipient_address_type": "Manual",
  "recipient_address_manual": {"line1": "456 Oak Ave", "city": "Springfield", "state": "ST", "zip": "67890"}
}
```

POST to `https://postalform.com/api/machine/mpp/orders` → 402 response.

#### 2. Extract Stripe challenge

From the 402 response headers, grab the `www-authenticate` line with `method="stripe"`. The full header looks like:
```
Payment id="RD1OJPaVrXN8xl3so6sCk-4bMelahTGuF3hoxtchQVA", realm="postalform.com", method="stripe", intent="charge", request="<base64>"
```

Decode with:
```bash
npx -y @stripe/link-cli mpp decode --challenge '<full header value>' --format json
```

Returns: `id`, `realm`, `method`, `intent`, `network_id`, `request_json` (contains amount, currency, externalId/orderId).

#### 3. Create SPT spend-request

```bash
npx -y @stripe/link-cli spend-request create \
  --paymentMethodId "pm_visa_xxxxxxxxxxxx" \
  --credentialType shared_payment_token \
  --networkId "<network_id_from_decode>" \
  --amount <amount_in_cents> \
  --currency usd \
  --context "<100+ chars: what is this purchase and why>" \
  --lineItem "name:<item>,unit_amount:<cents>,quantity:1" \
  --total "type:total,display_text:Total,amount:<cents>" \
  --requestApproval --format json
```

Returns `approval_url`. User approves in Link mobile app. Poll with:
```bash
npx -y @stripe/link-cli spend-request retrieve <lsrq_id> --interval 3 --max-attempts 200 --format json
```

Status transitions: `pending_approval` → `approved`. The SPT token is in the `--full-output` response at `shared_payment_token.id` (format: `spt_<stripe_id>`).

#### 4. Pay via MPP

```bash
npx -y @stripe/link-cli mpp pay \
  "https://postalform.com/api/machine/mpp/orders" \
  --spendRequestId "<lsrq_id>" \
  --method POST \
  --data '<exact same JSON as step 1>' \
  --header "Content-Type: application/json" \
  --format json
```

Link CLI internally: retrieves SPT, signs the challenge, retries with `Authorization: Payment <signed_credential>`. 

#### 5. Verify settlement

```bash
curl -s "https://postalform.com/api/machine/mpp/orders/<order_id>"
```

Look for `status: "payment_settled"` and `is_paid: true`.

### the user's Payment Methods

| ID | Type | Name | Last4 |
|----|------|------|-------|
| `pm_visa_xxxxxxxxxxxx` | CARD | Visa Credit | 1234 |
| `pm_mc_xxxxxxxxxxxx` | CARD | Bilt World Elite Mastercard | 5678 |
| `pm_alaska_xxxxxxxxxxxx` | CARD | Alaska Airlines | 0000 |

## the user's Payment Methods
...
### Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ARG_MAX / Argument list too long` | Base64 PDF in shell argument | Use upload_token instead |
| `Upload token already used` | Token consumed by previous order | Create fresh upload + fresh request_id |
| `Malformed Credential` | Wrong Authorization format | Use link-cli mpp pay, don't build auth manually |
| `Stripe PaymentIntent failed` | SPT scoped to wrong challenge | Re-create spend-request for THIS order's challenge |
| `Too many unpaid order attempts` | Rate limited | Wait 1 hour or complete a payment |
| `create_order_draft ENOENT` | MCP tool broken on production | Use MPP machine API instead |
| `VALIDATION_ERROR: context too_small` | Context <100 chars | Use 100+ char description |
| `spend-request 'list' not found` | No list subcommand | Retrieve by ID only — no listing |
| `Upload token consumed on failed payment` | mpp pay burns token even on 422/429 | Re-upload PDF for every payment retry |

### Multi-Order Efficiency — Single Spend-Request

The Stripe `network_id` is stable per merchant (profile_61Tt... for PostalForm). A single approved spend-request can pay multiple orders from the same merchant if:
- Same `networkId`
- Same amount ($2.00 for each 4x6 postcard)
- Same merchant

Create one spend-request → approve once → pay each order with `mpp pay --spendRequestId <same_id>` using that order's specific payload (fresh upload token per order).

### Rate Limit Recovery Pattern

When hitting "Too many unpaid order attempts" (429):
1. **Do NOT retry immediately** — each retry resets the cooldown clock
2. Wait at least 45-60 minutes
3. Schedule cron jobs 1 hour apart for multiple cards
4. Fresh upload tokens needed per order (tokens consume on ANY MPP call)
5. The 429 applies to BOTH order creation AND payment — both endpoints are blocked
