---
name: postalform-lessons
description: Battle-tested PostalForm mailing + MPP payment patterns. When you need to mail postcards/cards via PostalForm, use the MPP machine API, or handle Link CLI spend-requests. Load this alongside postalform-mailing.
version: 1.0.0
---

# PostalForm Lessons — Post-Mortem from May 11, 2026

After burning ~20 upload tokens, hitting rate limits, and debugging MPP payment flow for 4 hours. These are the hard-won patterns that actually work.

⚠️ **PII:** Names, emails, and payment IDs use `{{PII_*}}` placeholders. Load `~/.hermes/memory/pii.json` and replace before executing.

## The Golden Path (What Works)

### 1. Compress PDFs BEFORE anything else

PostalForm's Cloudflare rejects base64 payloads >~2MB (413 error). Ghibli PNG-based PDFs are 1.5-1.8MB → base64 ~2.5MB → rejected. Upload tokens are single-use and break retry.

**Always compress images to JPEG before generating PDFs:**

```python
from PIL import Image
img = Image.open("artwork.png")
if img.mode in ('RGBA', 'P'): img = img.convert('RGB')
img.save("artwork.jpg", 'JPEG', quality=85)
# 1.7MB PNG → 210KB JPEG (12% size)
```

Then regenerate PDFs with JPEG images. Target PDF: <300KB. Base64: ~400KB — well under 413 limit.

### 2. Use base64 data URLs, NEVER upload tokens

Upload tokens are single-use. They're consumed by the order creation step (402 response). The MPP retry re-sends the same payload — but the token is already burned. This is a protocol deadlock.

```json
{
  "pdf": "data:application/pdf;base64,<base64_content>"
}
```

Base64 data URLs can be reused infinitely across retries. No single-use problem.

### 3. curl -d @file, NEVER inline base64 in CLI args

Shell ARG_MAX (~2MB on Linux) kills link-cli/npx when base64 payload is passed as a command-line argument:

```bash
# ❌ BROKEN: ARG_MAX
npx link-cli mpp pay --data "$(cat payload.json)"

# ✅ WORKS: curl with file
curl -s -d @payload.json https://postalform.com/api/machine/mpp/orders
```

### 4. One SPT per payment — never reuse

Each Shared Payment Token (SPT) is single-use. One SPT pays exactly one order. Attempting to reuse across multiple orders fails with "Stripe PaymentIntent failed."

**Per-card flow:**
1. Fresh spend-request → user approves → get SPT
2. Use that SPT for exactly one mppx payment
3. Next card needs fresh spend-request + fresh SPT

### 5. mppx serialization for payment (avoid mpp pay)

The `link-cli mpp pay` command does a 2-step: send payload → get 402 → retry. Step 1 consumes the upload token. Step 2 fails.

Instead, use mppx to manually serialize the credential:

```bash
npm install mppx --silent
```

```javascript
// mppx_gen.js
const { Challenge, Credential } = require('mppx');
const mockResponse = {
  status: 402,
  headers: new Map([['WWW-Authenticate', process.argv[2]]])
};
const challenges = Challenge.fromResponseList(mockResponse);
const stripeChallenge = challenges.find(c => c.method === 'stripe');
const credential = Credential.from({
  challenge: stripeChallenge,
  payload: { spt: process.argv[3] }
});
console.log(Credential.serialize(credential));
```

Then pay in two steps:
```bash
# Step 1: Get challenge
curl -s -D headers.txt -d @payload.json https://postalform.com/api/machine/mpp/orders

# Step 2: Pay with mppx auth
AUTH=$(node mppx_gen.js "$(grep 'method=\"stripe\"' headers.txt)" "$SPT_TOKEN")
curl -s -H "Authorization: $AUTH" -d @payload.json https://postalform.com/api/machine/mpp/orders
```

### 6. Full verified flow per card

```python
import base64, json, uuid, subprocess

# 1. Read compressed PDF
with open("card-jpg.pdf", "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()

# 2. Build payload
payload = {
    "request_id": str(uuid.uuid4()),
    "buyer_name": "{{PII_KARAN_NAME}}",
    "buyer_email": "{{PII_KARAN_EMAIL}}",
    "mailpiece_type": "postcard",
    "postcard_size": "4x6",
    "pdf": f"data:application/pdf;base64,{pdf_b64}",
    "sender_name": "{{PII_KARAN_NAME}}",
    "sender_address_type": "Manual",
    "sender_address_manual": {"line1":"...","city":"...","state":"NY","zip":"..."},
    "recipient_name": "...",
    "recipient_address_type": "Manual",
    "recipient_address_manual": {"line1":"...","city":"...","state":"...","zip":"..."}
}

# 3. Save to file
with open("payload.json", "w") as f: json.dump(payload, f)

# 4. Get 402 challenge
subprocess.run(["curl","-s","-D","headers.txt",
    "https://postalform.com/api/machine/mpp/orders",
    "-H","Content-Type: application/json",
    "-d","@payload.json"])

# 5. Extract Stripe challenge from headers
stripe_auth = None
with open("headers.txt") as f:
    for line in f:
        if 'www-authenticate:' in line.lower() and 'method="stripe"' in line:
            stripe_auth = line.split(':',1)[1].strip(); break

# 6. Decode to get network_id
decode = subprocess.run(["npx","-y","@stripe/link-cli","mpp","decode",
    "--challenge",stripe_auth,"--format","json"],
    capture_output=True, text=True)
d = json.loads(decode.stdout)
nid = d['network_id']; amt = d['request_json']['amount']

# 7. Create spend-request (context MUST be >=100 chars)
sr = subprocess.run(["npx","-y","@stripe/link-cli","spend-request","create",
    "--paymentMethodId","{{PII_LINK_PM_ID}}",
    "--credentialType","shared_payment_token",
    "--networkId",nid,"--amount",amt,"--currency","usd",
    "--context","PostalForm 4x6 Ghibli postcard for <name> — <city> <state>. Mother's Day card. Part of batch of cards for friends at $2 each.",
    "--lineItem",f"name:<name> 4x6 card,unit_amount:{amt},quantity:1",
    "--total",f"type:total,display_text:Total,amount:{amt}",
    "--requestApproval","--format","json"],
    capture_output=True, text=True)
sr_data = json.loads(sr.stdout)
if isinstance(sr_data, list): sr_data = sr_data[0]
approval_url = sr_data.get('approval_url')

# 8. User approves → poll → get SPT
# Poll: npx link-cli spend-request retrieve <lsrq_id> --interval 3 --max-attempts 200
# Get SPT from approved response: data.shared_payment_token.id

# 9. Pay with mppx
auth = subprocess.run(["node","mppx_gen.js", stripe_auth, spt_token],
    capture_output=True, text=True).stdout.strip()
subprocess.run(["curl","-s",
    "https://postalform.com/api/machine/mpp/orders",
    "-H","Content-Type: application/json",
    "-H",f"Authorization: {auth}",
    "-d","@payload.json"])
```

## Rate Limiting Rules

- PostalForm rate-limits after ~5+ unpaid order attempts from same IP
- 429 response: "Too many unpaid order attempts. Complete a payment or wait an hour."
- **Space cards 1 hour apart minimum.** Never batch-submit.
- Each 402 (challenge issuance) counts as an "unpaid attempt"
- Completed payments clear the rate limit counter

## Link CLI Pitfalls

| Issue | Fix |
|-------|-----|
| Context <100 chars | `--context` must be >=100 characters; add detail |
| Forgot --requestApproval | Spend-request stays pending without notification |
| ARG_MAX on large payloads | Use `curl -d @file` not inline data |
| SPT already consumed | Each SPT is single-use; create new spend-request |
| Old SPT expired | SPTs valid ~24h from creation |

## Browser / Path C

- Chrome sandbox broken in container/VM environments
- browser_navigate tool doesn't support `--no-sandbox` flag
- Website checkout at postalform.com/postcards = manual only
- Don't attempt browser automation for PostalForm in current environment
- Stick to curl + MPP API path

## Process Anti-Patterns (Don't Repeat)

1. ❌ Creating orders in rapid succession → rate limited
2. ❌ Reusing upload tokens after 402 response
3. ❌ Trying to pay with consumed SPT tokens
4. ❌ Passing large payloads as CLI arguments (ARG_MAX)
5. ❌ Not compressing PDFs before base64 encoding (413 errors)
6. ❌ Creating spend-requests without --requestApproval
7. ❌ Trying to use one SPT for multiple payments
8. ❌ Not spacing cron jobs 1 hour apart
9. ❌ Creating new orders before rate limit clears

## Verification

After payment, always verify:
```bash
curl -s "https://postalform.com/api/machine/mpp/orders/<order_id>" | python3 -m json.tool
```
Look for: `"is_paid": true`, `"status": "payment_settled"`, `"payment_status": "paid"`.
