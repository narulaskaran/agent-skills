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
  "buyer_name": "Karan Narula",
  "buyer_email": "narulaskaran@gmail.com",
  "mailpiece_type": "postcard",
  "postcard_size": "6x9",
  "pdf": {"upload_token": "pfu_..."},
  "sender_name": "Karan Narula",
  "sender_address_type": "Manual",
  "sender_address_manual": {"line1": "148 W 73rd St", "line2": "Apt 2B", "city": "New York", "state": "NY", "zip": "10023"},
  "recipient_name": "Gurpreet Narula",
  "recipient_address_type": "Manual",
  "recipient_address_manual": {"line1": "9722 228th Terrace NE", "city": "Redmond", "state": "WA", "zip": "98053"}
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
  --paymentMethodId "csmrpd_61SL4jq1qDVuReQ2i41BlKzBtMJGOFU0" \
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

### Karan's Payment Methods

| ID | Type | Name | Last4 |
|----|------|------|-------|
| `csmrpd_61SL4jq1qDVuReQ2i41BlKzBtMJGOFU0` | CARD | Visa Credit | 1116 |
| `csmrpd_61QQ9VVMrxsOCl7Re41BlKzBtMJGOCfQ` | CARD | Bilt World Elite Mastercard | 6872 |
| `csmrpd_61QQ92SLNUWHRUP6b41BlKzBtMJGO25g` | CARD | Alaska Airlines | 0770 |

Default: Visa Credit (1116). Use `--paymentMethodId` to override.

### Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ARG_MAX / Argument list too long` | Base64 PDF in shell argument | Use upload_token instead |
| `Upload token already used` | Token consumed by previous order | Create fresh upload + fresh request_id |
| `Malformed Credential` | Wrong Authorization format | Use link-cli mpp pay, don't build auth manually |
| `Stripe PaymentIntent failed` | SPT scoped to wrong challenge | Re-create spend-request for THIS order's challenge |
| `Too many unpaid order attempts` | Rate limited | Wait 1 hour or complete a payment |
| `create_order_draft ENOENT` | MCP tool broken on production | Use MPP machine API instead |
