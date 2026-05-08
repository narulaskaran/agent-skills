---
name: postalform-mailing
description: Design and mail physical cards/postcards via PostalForm agent API. Covers image-to-cartoon generation via OpenRouter, HTML card design to exact bleed specs, PDF export, and machine-payment submission.
---

# PostalForm Card Mailing

End-to-end: generate illustrated card art → design HTML card → export PDF to exact PostalForm bleed specs → submit via agent API.

## Quick Reference

| Step | Tool |
|------|------|
| Cartoonify photo | OpenRouter `google/gemini-2.5-flash-image` (cheapest image-gen, `text+image→text+image`) |
| Design card | HTML/CSS + WeasyPrint → PDF |
| Upload PDF | MCP `postalform.create_pdf_upload` → upload URL → upload_token |
| Validate order | `POST https://postalform.com/api/machine/orders/validate` |
| Upload PDF | MCP `postalform.create_pdf_upload` → upload URL → upload_token |
| Validate order | `POST https://postalform.com/api/machine/orders/validate` |
| Create MPP order | `POST https://postalform.com/api/machine/mpp/orders` → 402 with Stripe SPT challenge |
| Pay via Link CLI | Decode challenge → Link CLI spend-request (SPT) → user approves → `link-cli mpp pay` → retry order |
| Track | `GET https://postalform.com/api/machine/mpp/orders/:id` |
| Reference | `references/payment-flows.md` (Link CLI + MPP SPT flow details) |
| Reference | `references/mppx-credential-guide.md` (mppx serialization for large payloads) |
| Reference | `references/lob-print-specs.md` (Lob paper stock, coating, quality) |

## Prerequisites

```bash
uv pip install weasyprint pymupdf  # PDF generation + inspection
```

OpenRouter API key from `~/.hermes/.env` (`OPENROUTER_API_KEY=`).

## Step 1: Template Dimensions (ALWAYS FIRST)

Before designing, download PostalForm's official bleed template for chosen size:

```bash
# 6x9 (landscape): 9.25" × 6.25" bleed → 9" × 6" trim
curl -sL "https://postalform.com/postcard-guidelines/us_intl_postcard_9inx6in.pdf" -o template.pdf
python3 -c "import fitz; d=fitz.open('template.pdf'); print(f'{d[0].rect.width/72:.2f}x{d[0].rect.height/72:.2f} in')"
```

Template specs: `references/postcard-specs.md`

Key rules:
- Page size must match template exactly (including bleed)
- Front = Page 1, Back = Page 2 (mailing side)
- Do NOT put addresses on back — PostalForm fills mailing block
- Text in safe zone (0.125" inside trim line)

## Step 2: Generate Illustrated Art (Optional)

Use OpenRouter image models for style transfer from photos:

```python
import json, base64

api_key = "sk-or-v1-..."
img_path = "/path/to/photo.jpg"

with open(img_path, 'rb') as f:
    img_b64 = base64.b64encode(f.read()).decode()

payload = {
    "model": "google/gemini-2.5-flash-image",  # cheapest image-gen model
    "max_tokens": 8192,
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Turn this photo into [STYLE DESCRIPTION]. Keep all people recognizable. Output the image."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
        ]
    }]
}

# Save payload → curl → extract image from response.images[0].image_url.url
```

Models:
- `google/gemini-2.5-flash-image` — cheapest, good quality, supports img2img
- `google/gemini-3.1-flash-image-preview` — newer, sometimes more creative
- `openai/gpt-5.4-image-2` — expensive, high quality

Response format: `choices[0].message.images[0].image_url.url` contains `data:image/png;base64,...`

## Step 3: Design Card in HTML

Use `@page { size: W in H in; margin: 0; }` to match template exactly.

```css
@page { size: 9.25in 6.25in; margin: 0; }
body { width: 9.25in; height: 6.25in; overflow: hidden; }
```

Safe zone: text 0.125" from edges (inside trim line).
Bleed: artwork/background extends to page edge.

## Step 4: Export 2-Page PDF

```python
import fitz
from weasyprint import HTML

HTML('front.html').write_pdf('front.pdf')
HTML('back.html').write_pdf('back.pdf')

doc = fitz.open()
doc.insert_pdf(fitz.open('front.pdf'))
doc.insert_pdf(fitz.open('back.pdf'))
doc.save('card.pdf')

# Verify dimensions
d = fitz.open('card.pdf')
print(f"Page 1: {d[0].rect.width/72:.2f}x{d[0].rect.height/72:.2f} in")
```

## Step 5: Submit to PostalForm

**Two paths: MPP machine API (primary) or MCP draft (unreliable).**

### Path A: MPP Machine API (RECOMMENDED)

The MPP endpoint at `/api/machine/mpp/orders` supports Stripe SPT with card + Link payments. This is the production path that works. The MCP `create_order_draft` tool is currently broken on production (returns an internal server error trying to read a test fixture).

#### 5a. Upload PDF first

Large base64 PDFs can hit transport limits. Upload via MCP first:

```bash
# 1. Initialize MCP session (SSE transport, requires session ID)
SESSION=$(curl -s -i "https://postalform.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hermes","version":"1.0"}}}' \
  2>&1 | grep 'mcp-session-id:' | tr -d '\r' | awk '{print $2}')

# 2. Create upload slot
TOKEN=$(curl -s -N "https://postalform.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"postalform.create_pdf_upload","arguments":{"file_name":"card.pdf"}}}' \
  2>&1 | grep 'data:' | sed 's/^data: //' | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['structuredContent']['upload_token'])")

UPLOAD_URL=$(curl -s -N "https://postalform.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"postalform.create_pdf_upload\",\"arguments\":{\"file_name\":\"card.pdf\"}}}" \
  2>&1 | grep 'data:' | sed 's/^data: //' | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['structuredContent']['upload_url'])")

# 3. Upload the actual PDF
curl -s -X POST "$UPLOAD_URL" -F "file=@/path/to/card.pdf"
```

#### 5b. Validate (no charge):
```
POST https://postalform.com/api/machine/orders/validate
Content-Type: application/json

{
  "request_id": "<UUID>",
  "buyer_name": "Karan Narula",
  "buyer_email": "narulaskaran@gmail.com",
  "mailpiece_type": "postcard",
  "postcard_size": "6x9",
  "pdf": "data:application/pdf;base64,...",
  "sender_name": "Karan Narula",
  "sender_address_type": "Manual",
  "sender_address_manual": {"line1": "...", "line2": "...", "city": "...", "state": "NY", "zip": "..."},
  "recipient_name": "Gurpreet Narula",
  "recipient_address_type": "Manual",
  "recipient_address_manual": {"line1": "...", "city": "...", "state": "WA", "zip": "..."}
}
```

Validation returns quote (`price_usd`, `page_count`, `postcard_size`, `provider`).

#### 5c. Submit via MPP (gets 402 with payment challenge):
```
POST https://postalform.com/api/machine/mpp/orders
```
Same body as validate. Returns 402 with:
- `x-payment-protocol: mpp`
- `www-authenticate: Payment` headers (one per supported method)
- Methods: `tempo` (crypto USDC) or `stripe` (card/Link via Stripe SPT)
- `paymentMethodTypes: ["card", "link"]` on the Stripe method

The Stripe method creates a PaymentIntent. Payment must be completed autonomously via Stripe SPT flow, then the same request body is replayed with `Authorization: Payment ...` header.

#### 5d. Poll status:
```
GET https://postalform.com/api/machine/mpp/orders/:id
```

### Step 6: Pay via Link CLI (MPP Stripe SPT)

Karan's Link account is already authenticated via `@stripe/link-cli`. The SPT flow eliminates the need for PostalForm's Stripe keys.

**Prerequisites:**
- Link CLI installed and authenticated (`npx -y @stripe/link-cli`)
- Default payment method: Visa Credit (ID: `csmrpd_61SL4jq1qDVuReQ2i41BlKzBtMJGOFU0`, last4 1116)
- User must approve spend-request in the Link mobile app

**Flow:**

1. **Decode the Stripe challenge** from the 402 response's `www-authenticate` header (the `method="stripe"` one):
   ```bash
   npx -y @stripe/link-cli mpp decode \
     --challenge 'Payment id="...", realm="postalform.com", method="stripe", ...' \
     --format json
   ```
   Extracts `network_id`, `request_json.amount`, `request_json.externalId` (order ID).

2. **Create spend-request** for SPT credential:
   ```bash
   npx -y @stripe/link-cli spend-request create \
     --paymentMethodId "csmrpd_61SL4jq1qDVuReQ2i41BlKzBtMJGOFU0" \
     --credentialType shared_payment_token \
     --networkId "<network_id_from_decode>" \
     --amount <amount_in_cents> \
     --currency usd \
     --context "<100+ char description of purchase and rationale>" \
     --lineItem "name:<item>,unit_amount:<cents>,quantity:1" \
     --total "type:total,display_text:Total,amount:<cents>" \
     --requestApproval --format json
   ```
   Returns `approval_url` — user must approve in Link app.
   Start polling immediately with `spend-request retrieve <id> --interval 3 --max-attempts 200`.

3. **After approval**, use the spend request to pay:
   ```bash
   npx -y @stripe/link-cli mpp pay \
     --spend-request-id "<lsrq_...>" \
     --format json
   ```
   Returns `authorization_header` — use this as `Authorization: Payment <value>`.

4. **Retry the MPP order** with the Authorization header. Replay the exact same request body (including same `request_id`) that got the 402, but add:
   ```
   Authorization: Payment <value_from_mpp_pay>
   ```
   PostalForm settles and returns 202.

Full step-by-step session notes: `references/payment-flows.md`

### Path B: MCP create_order_draft (BROKEN — DO NOT USE)

The `postalform.create_order_draft` MCP tool returns an internal server error:
`ENOENT: no such file or directory, open '.../tests/fixtures/sample.pdf'`

This is a production bug — the tool references a test fixture that doesn't exist in the production deployment. Use Path A instead.

Full API interaction reference: `references/api-interactions.md`

## Step 2.5: Find Safe Zone for Text Overlay (CRITICAL)

Before placing any text on the card, use `vision_analyze` to find empty space in the artwork where text won't cover faces:

```
vision_analyze(image_url=artwork, question="Where is empty space (top, bottom, left, right) where text can go without covering anyone's face?")
```

If no safe zone exists in the image itself, use a translucent overlay panel positioned in the identified safe area. Do not guess overlay placement — always verify first.

## Step 3.5: Review Before Showing User (CRITICAL)

After generating the card preview, ALWAYS run `vision_analyze` on the output to verify:
- No faces are covered by overlay
- No people are cropped by `object-fit`
- Text is readable against background
- Layout looks intentional, not broken

**Never show the user output you haven't reviewed yourself.** Karan will call out unreviewed slop.

## Pitfalls

1. **Page size mismatch.** Always download template first. Wrong dimensions = printing issues.
2. **DO NOT use `object-fit: cover` for family photos.** `cover` crops edges to fill the frame, cutting people off. Use `object-fit: contain` to show the full image — all people must be visible. Only use `cover` for abstract backgrounds.
3. **Overlay covering faces.** Always run `vision_analyze` on the artwork to find safe zones before placing text. The natural empty space is often at the top (sky) — not the right side if someone is taking a selfie there. Multiple rounds of moving overlay = avoidable with upfront analysis.
4. **Rotating images 90° makes people sideways.** Never rotate a photo of standing people 90° — it looks broken. Only rotate to correct orientation from camera metadata.
5. **Address leakage.** Don't put addresses in PDF — PostalForm adds mailing block to back.
6. **Gemini image model.** Response includes `images` array alongside `content` text. Extract from `choices[0].message.images[0].image_url.url`, not from the text content.
7. **Show preview before submitting.** User must approve card design and recipient details before payment.
8. **JSON with base64.** Large base64 image data in responses can break `json.load()` — use `json.load(f, strict=False)` or save to file first with `curl -o`.
9. **Credit limits.** GPT-5.4-image-2 may hit OpenRouter credit limits. Use Gemini flash models for cheaper generation.
10. **MCP create_order_draft is broken.** Returns ENOENT for missing test fixture. Use MPP machine API (`/api/machine/mpp/orders`) instead. The MCP is still useful for PDF uploads (`create_pdf_upload`) and address search, but not for order creation.
11. **MPP requires fresh request_id per protocol.** The same request_id cannot be used across x402 and MPP endpoints. If you already submitted to one, generate a new UUID for the other.
12. **MCP uses SSE transport.** Requires `Accept: application/json, text/event-stream` header and a session ID from the `mcp-session-id` response header. Send session ID in subsequent requests.
13. **Address fields must be objects, not JSON strings.** MCP tools expect `sender_address_manual` and `recipient_address_manual` as native objects, not stringified JSON.
14. **Validate before submitting.** Always call `/validate` first to catch errors without creating an order. Check for missing fields like `sender_name`, `recipient_name`, `buyer_email`, and UUID-format `request_id`.
15. **Stripe SPT uses Link CLI, NOT raw Stripe API.** The MPP Stripe challenge provides `networkId` and `paymentMethodTypes: ["card", "link"]`. Do NOT try to find PostalForm's `pk_live_` key — the autonomous payment path uses `@stripe/link-cli` (already installed and authenticated with Karan's Link account). Use `link-cli mpp decode` to extract the challenge, create an SPT spend-request, get user approval, then `link-cli mpp pay` to generate the `Authorization: Payment` header. See `references/payment-flows.md` for the full flow.
16. **Rate limiting on unpaid orders.** PostalForm rate-limits after multiple unpaid order attempts from the same IP. If you hit "Too many unpaid order attempts," fall back to Path C (website manual checkout) or wait 1 hour. Generate fresh request_ids for each attempt — don't reuse across x402/MPP protocols.
17. **PDF as data URL must be a string.** The `pdf` field in the machine API expects `"data:application/pdf;base64,..."` as a string value, NOT `{"data": "..."}` as an object. Getting this wrong gives confusing "not a valid PDF" errors.
18. **Path C always works.** When all API/MPP/MCP paths are blocked, user can manually complete checkout at [postalform.com/postcards](https://postalform.com/postcards) — upload the PDF, fill addresses, pay with Link/card. This is the reliable fallback.
19. **ARG_MAX breaks link-cli with large payloads.** Shell argument list limit (~2MB on Linux) prevents passing base64 PDF data through `link-cli mpp pay --data`. Use the mppx workaround: serialize the credential with `mppx` Node.js library, then send via `curl -d @file` with the `Authorization` header. See `references/mppx-credential-guide.md`.
20. **Bare SPT token rejected.** PostalForm requires the full serialized MPP credential (`Credential.serialize(...)`), not a raw `spt_...` string. The credential must include the original challenge that was answered.
