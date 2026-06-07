---
name: postalform-mailing
description: Design and mail physical cards/postcards via PostalForm agent API. Covers image-to-cartoon generation via OpenRouter, HTML card design to exact bleed specs, PDF export, and machine-payment submission.
---

# PostalForm Card Mailing

End-to-end: generate illustrated card art → design HTML card → export PDF to exact PostalForm bleed specs → submit via agent API.

⚠️ **Before using this skill, load `postalform-lessons` and `mpp-payments` skills.** They contain battle-tested patterns that prevent hours of debugging. Key: compress PDFs to JPEG, use base64 data URLs (never upload tokens), mppx serialization for auth, one SPT per payment, space orders 1h apart.

## Quick Reference

| Step | Tool |
|------|------|
| Cartoonify photo | OpenRouter `google/gemini-2.5-flash-image` (cheapest image-gen, `text+image→text+image`) |
| Design card | HTML/CSS + WeasyPrint → PDF |
| Compress PDF | Convert artwork PNG → JPEG before rendering (see `references/base64-jpeg-workaround.md`) |
| Upload PDF | MCP `postalform.create_pdf_upload` → upload URL → upload_token |
| Validate order | `POST https://postalform.com/api/machine/orders/validate` |
| Create MPP order | `POST https://postalform.com/api/machine/mpp/orders` → 402 with Stripe SPT challenge |
| Pay via Link CLI | Decode challenge → Link CLI spend-request (SPT) → user approves → `link-cli mpp pay` → retry order |
| Pay via base64+mppx (autonomous) | Pre-approved SPT → base64 data URL → 402 → `mppx` serialize → curl retry (no Link CLI needed, cron-compatible) |
| Pay via base64 (alt) | Compress PDF → base64 data URL → `curl -d @file` → mppx auth → retry (bypasses upload tokens) |
| Track | `GET https://postalform.com/api/machine/mpp/orders/:id` |
| Reference | `references/payment-flows.md` (Link CLI + MPP SPT flow details) |
| Reference | `references/mppx-credential-guide.md` (mppx serialization for large payloads) |
| Script | `scripts/mppx_gen.js` (serialize MPP Stripe SPT credential — `node scripts/mppx_gen.js "<challenge>" "<spt>"` → `Authorization: Payment ...` header) |
| Reference | `references/lob-print-specs.md` (Lob paper stock, coating, quality) |
| Reference | `references/batch-orders.md` (rate limits, multi-header parsing, token lifecycle) |
| Reference | `references/stale-spt-recovery.md` (recovery when SPT exists but order is unpayable) |
| Reference | `references/spt-paymentintent-failed.md` (SPT serialized correctly but Stripe rejects PaymentIntent) |
| Reference | `references/recovery-state.md` (recovery state format for stalled payments) |
| Reference | `references/base64-jpeg-workaround.md` (JPEG compression → base64 payloads under 413 limit) |
| Script | `scripts/pay_with_base64.py` (autonomous payment: base64 PDF + SPT → curl → 402 → mppx → retry) |

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

## Step 2: Simple Path — Original Photo (No Illustration)

When user wants the original photo on the card without Ghibli-style transformation, skip Step 2 (image generation) entirely. Use `object-fit: contain` to show the full photo.

**⚠️ Before designing, compress images to JPEG.** PNG-based PDFs are 1.5-1.8MB → base64 ~2.5MB → rejected by Cloudflare (413). Convert to JPEG at 85% quality: 200-230KB PDFs → base64 ~300KB → safe. This is MANDATORY for the base64 payment flow in Step 5.

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

### Full-Bleed Ghibli Card Pattern

When using illustrated art (Ghibli or other generated art) on a landscape card, use `object-fit: cover` to fill the entire card, with a translucent text bar overlaid at the bottom:

```css
.photo-area { width: 6.25in; height: 4.25in; position: relative; }
.photo-area img { width: 6.25in; height: 4.25in; object-fit: cover; }
.text-bar {
  position: absolute; bottom: 0.15in; left: 0; right: 0;
  height: 0.4in; display: flex; align-items: center; justify-content: center;
  background: rgba(245, 240, 232, 0.85);
  font-size: 11pt; color: #5a4a3a; letter-spacing: 1px;
}
```

This is the preferred pattern for Ghibli cards — art fills bleed, text sits in a translucent bar within safe zone. Always vision-review after to confirm no faces are covered.

### Card Text: Avoid Unicode Emoji

Unicode emoji (🫶, ❤️, etc.) may not render correctly in WeasyPrint/PostalForm fonts, showing as garbled characters (e.g., "ḍŸ«¶"). Use ASCII alternatives:
- `&lt;3` → "<3" (heart)
- `&mdash;` → "—" (em dash)
- HTML entities, not raw Unicode, for any special characters.

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

**CSS embedding:** When WeasyPrint is called from a Python script or subprocess, linked `<link rel="stylesheet">` files may not resolve, causing `@page` directives to be ignored and the PDF to default to A4. Always embed CSS directly in `<style>` tags within the HTML file to guarantee page size is honored.

## Step 5: Submit to PostalForm

**⚠️ LOAD `postalform-lessons` AND `mpp-payments` SKILLS FIRST.** They contain battle-tested payment patterns that prevent hours of debugging. The flow below is a summary — the lessons skills have the full verified path.

### Path A: Base64 + mppx (RECOMMENDED — WORKS)

Upload tokens are single-use (consumed on 402 response) and break MPP retry. Use base64 data URLs instead:

1. Compress PDF to JPEG-based (~200KB)
2. Base64 encode and embed as `"pdf": "data:application/pdf;base64,..."`
3. Save payload to file: `json.dump(payload, f)`
4. Get challenge: `curl -s -D headers.txt -d @payload.json <endpoint>`
5. Extract Stripe challenge from www-authenticate header
6. Create spend-request, get user approval, get SPT
7. Generate auth: `node mppx_gen.js "<challenge>" "<spt>"`
8. Pay: `curl -s -H "Authorization: <auth>" -d @payload.json <endpoint>`

**Key rules:** one SPT per payment, space orders ≥1h apart, use `curl -d @file` (never inline). Full code in `mpp-payments` skill.

### Path B: MPP Machine API (LEGACY — upload tokens are broken)

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
  "buyer_name": "Jane Doe",
  "buyer_email": "user@example.com",
  "mailpiece_type": "postcard",
  "postcard_size": "6x9",
  "pdf": "data:application/pdf;base64,...",
  "sender_name": "Jane Doe",
  "sender_address_type": "Manual",
  "sender_address_manual": {"line1": "...", "line2": "...", "city": "...", "state": "NY", "zip": "..."},
  "recipient_name": "Jane Smith",
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

the user's Link account is already authenticated via `@stripe/link-cli`. The SPT flow eliminates the need for PostalForm's Stripe keys.

**Prerequisites:**
- Link CLI installed and authenticated (`npx -y @stripe/link-cli`)
- Default payment method: Visa Credit (ID: `pm_visa_xxxxxxxxxxxx`, last4 1116)
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
     --paymentMethodId "pm_visa_xxxxxxxxxxxx" \
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

### Step 6 Alternate: Pay via Base64 + MPPX + Pre-Approved SPT (Autonomous / Cron)

When SPT token is already approved (e.g., from prior spend-request) and user isn't present. Bypasses Link CLI entirely — serialize credential with `mppx` Node.js library and curl directly. This is the ONLY cron-compatible MPP payment path.

**Prerequisites:**
- Pre-approved SPT token (`spt_...`, from spend-request that was already approved in Link app)
- `mppx` npm package: `cd /tmp && npm install mppx --silent`
- Helper script `mppx_gen.js` (see `references/mppx-credential-guide.md`)
- PDF compressed via JPEG (pitfall #30) so base64 stays under ~2MB

**Flow:**

1. **Base64 encode PDF** — use Python, NOT shell `base64 -w0` (pitfall #32):
   ```python
   import base64
   with open('card.pdf', 'rb') as f:
       b64_data = base64.b64encode(f.read()).decode('ascii')
   ```

2. **Build payload** with correct MPP field names (pitfall #33):
   ```json
   {
     "request_id": "<fresh UUID>",
     "buyer_name": "Jane Doe",
     "buyer_email": "user@example.com",
     "mailpiece_type": "postcard",
     "postcard_size": "4x6",
     "pdf": "data:application/pdf;base64,...",
     "sender_name": "Jane Doe",
     "sender_address_type": "Manual",
     "sender_address_manual": {"line1": "...", "line2": "...", "city": "...", "state": "NY", "zip": "..."},
     "recipient_name": "...",
     "recipient_address_type": "Manual",
     "recipient_address_manual": {"line1": "...", "line2": "...", "city": "...", "state": "...", "zip": "..."}
   }
   ```

3. **POST to MPP** → save headers with `-D`:
   ```bash
   curl -s -D /tmp/headers.txt -d @payload.json \
     -H "Content-Type: application/json" \
     https://postalform.com/api/machine/mpp/orders
   ```

4. **Extract Stripe challenge** from 402 headers (there are TWO `www-authenticate` headers — filter for `method="stripe"`):
   ```python
   import re
   match = re.search(r'www-authenticate: (Payment .*method="stripe".*)', headers)
   challenge = match.group(1).rstrip('\r')
   ```

5. **Serialize credential** with `mppx`:
   ```bash
   node /tmp/mppx_gen.js "<stripe_challenge>" "spt_1TVu..."
   ```
   Output is the `Authorization: Payment ...` header value.

6. **Retry with auth**:
   ```bash
   curl -s -H "Content-Type: application/json" \
     -H "Authorization: Payment <serialized>" \
     -d @payload.json \
     https://postalform.com/api/machine/mpp/orders
   ```
   Returns 200 with `"is_paid": true`, `"status": "paid"`.

7. **Verify**: `GET https://postalform.com/api/machine/mpp/orders/:id`

This flow was validated 2026-05-11 with `spt_example123456789` — 233KB JPEG-compressed PDF, 4x6 postcard, $2.00, paid in ~60s end-to-end with no user interaction.

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

**Never show the user output you haven't reviewed yourself.** the user will call out unreviewed slop.

## Rate Limiting & Batch Orders (CRITICAL)

PostalForm rate-limits after 3-4 unpaid MPP order attempts within ~60 seconds. If creating multiple cards, process them ONE at a time — create order → pay → settle → next. Submitting multiple orders before paying any triggers 429 "Too many unpaid order attempts. Complete a payment or wait an hour and try again."

The 429 blocks BOTH order creation AND payment attempts (including `link-cli mpp pay`). Recovery:
- Wait ~1 hour for cooldown
- Schedule a cron retry for approved spend-requests
- Fallback: website checkout (Path C) via `postalform-checkout` skill

**Cron retry pattern:** When retrying after a rate-limit cooldown:
1. Re-upload ALL PDFs fresh via MCP (assume all prior tokens consumed)
2. Generate new `request_id` UUIDs for all orders
3. Create NEW MPP orders → get fresh 402 challenges
4. Decode challenges → create NEW spend-requests (old SPTs are challenge-scoped, pitfall #28)
5. User must approve new spend-requests in Link app
6. Pay ONE at a time: `link-cli mpp pay` → verify 202 → next (prevents re-triggering rate limit)

**Important:** Old approved spend-requests cannot be reused across cooldown boundaries. Every recovery cycle needs fresh spend-request approvals because challenges (and their externalIds) change.

Upload tokens are consumed on order creation even if the order fails (402, 422, or 429). Failed orders need fresh uploads AND new request_ids.

## Pitfalls

1. **Page size mismatch.** Always download template first. Wrong dimensions = printing issues.
... (existing pitfalls)
20. **Bare SPT token rejected.** ...
21. **Timezone reporting.** the user is ET (NYC). Cron schedules are in UTC — always convert to ET before reporting times. Never report UTC times as if they're local. When the user corrects a time, it erodes trust.
2. **DO NOT use `object-fit: cover` for family photos.** `cover` crops edges to fill the frame, cutting people off. Use `object-fit: contain` to show the full image — all people must be visible. Only use `cover` for abstract backgrounds.
3. **Overlay covering faces.** Always run `vision_analyze` on the artwork to find safe zones before placing text. The natural empty space is often at the top (sky) — not the right side if someone is taking a selfie there. Multiple rounds of moving overlay = avoidable with upfront analysis.
4. **Photo rotation for landscape cards.** Portrait photos on landscape cards leave white space. Rotating 90° fills the card but puts people sideways — visually jarring for standing/full-body shots. However, for close-up face portraits, rotation can look intentional (dynamic tilted perspective). Follow user preference — if they request rotation to fill space, do it, but pre-rotate via PIL (`img.rotate(-90, expand=True)`) rather than CSS transform. Always vision-review rotated cards before showing the user, and flag the sideways orientation.
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
15. **Stripe SPT uses Link CLI, NOT raw Stripe API.** The MPP Stripe challenge provides `networkId` and `paymentMethodTypes: ["card", "link"]`. Do NOT try to find PostalForm's `pk_live_` key — the autonomous payment path uses `@stripe/link-cli` (already installed and authenticated with the user's Link account). Use `link-cli mpp decode` to extract the challenge, create an SPT spend-request, get user approval, then `link-cli mpp pay` to generate the `Authorization: Payment` header. See `references/payment-flows.md` for the full flow.
16. **Rate limiting on unpaid orders.** PostalForm rate-limits after 3-4 unpaid order attempts from the same IP within ~60 seconds. If you hit "Too many unpaid order attempts," fall back to Path C (website manual checkout) or wait 1 hour. Generate fresh request_ids for each attempt — don't reuse across protocols. See `references/batch-orders.md` for cron retry pattern.
17. **PDF as data URL must be a string.** The `pdf` field in the machine API expects `"data:application/pdf;base64,..."` as a string value, NOT `{"data": "..."}` as an object. Getting this wrong gives confusing "not a valid PDF" errors.
18. **Path C always works.** When all API/MPP/MCP paths are blocked, user can manually complete checkout at [postalform.com/postcards](https://postalform.com/postcards) — upload the PDF, fill addresses, pay with Link/card. This is the reliable fallback.
19. **Original photos may have pre-existing text.** When using original photos (no Ghibli art), check each photo for existing text overlays, captions, or meme text. The user may have shared an already-edited photo from Google Photos. Your added text must not clash with or cover the pre-existing text. If the original already has prominent text (e.g., "LET THAT SHIT GO"), place your "<3" below it in the safe zone bar.
20. **Unicode emoji render as garbage in PDFs.** WeasyPrint/PostalForm fonts don't include emoji glyphs — 🫶 becomes "ḍŸ«¶", ❤️ becomes random characters. Use ASCII alternatives: `<3` for hearts, `—` for dashes, HTML entities (`&lt;3`, `&mdash;`) in HTML source. Never use raw Unicode emoji in card text.
21. **ARG_MAX breaks link-cli with large payloads.** Shell argument list limit (~2MB on Linux) prevents passing base64 PDF data through `link-cli mpp pay --data`. Use the mppx workaround: serialize the credential with `mppx` Node.js library, then send via `curl -d @file` with the `Authorization` header. See `references/mppx-credential-guide.md`.
22. **Bare SPT token rejected.** PostalForm requires the full serialized MPP credential (`Credential.serialize(...)`), not a raw `spt_...` string. The credential must include the original challenge that was answered.
23. **Multiple www-authenticate headers in 402.** The 402 response returns BOTH `tempo` (crypto) and `stripe` challenges as separate `www-authenticate` headers. Parse ALL headers with `curl -D`, not just the first. Filter for `method="stripe"` — that's the one usable with Link CLI. Ignore tempo challenges.
24. **Upload tokens consumed on first use — every failure mode.** PostalForm marks upload tokens as consumed the moment they're referenced in an MPP order request. This includes ALL non-202 responses: 402 (payment required), 422 (invalid/expired token), 429 (rate limited). The failure chain: attempt 1 → 422 "token invalid/expired" (token consumed), attempt 2 → 422 "already used" (token already burned). ANY retry requires BOTH a fresh `create_pdf_upload` call AND a new `request_id` (UUID). Never reuse a request_id that was sent with a consumed token.

   **Consumed token poisons the order — no replacement token accepted.** Once an upload token is consumed for order `request_id` X, the server binds that order to the consumed token. Sending a FRESH upload token with the SAME request_id returns 422: "Upload token was already used. Order: X." The order is stuck — it needs the original (now-consumed) token. This means an order whose upload token was consumed by a 402 can NEVER be retried via upload_token. Bypass: compress the PDF (PNG→JPEG, see pitfall #30) and embed as base64 data URL — this avoids upload tokens entirely.
25. **`--data @file` not supported by `link-cli mpp pay`.** Using `--data @/path/to/file.json` does NOT read the file as the request body. It sends malformed content that returns HTTP 422 with `content-type: text/html`: "Invalid JSON, only supports object and array". Use inline `--data '<json>'` with shell-escaped single quotes instead. For payloads too large for inline (pitfall #21), use the mppx approach from `references/mppx-credential-guide.md`.
26. **Cron jobs can complete MPP flow with pre-approved SPT — but SPT may fail (pitfall #34).** The Link CLI spend-request approval requires user interaction in the Link mobile app — but once an SPT is approved, the **base64+mppx path** (Step 6 Alternate) can complete payment autonomously. No Link CLI needed for the payment step; serialize the credential with `mppx` and curl directly. This is the ONLY cron-compatible MPP payment path.

**When pre-approved SPT is provided in cron:** execute Step 6 Alternate flow. If SPT fails with "Stripe PaymentIntent failed" (pitfall #34), create a fresh spend-request, report the approval URL, and save state for recovery. Recovery after approval: replay same body (base64 payloads don't consume tokens) → get fresh 402 challenge → serialize new SPT with `mppx_gen.js` → retry with `curl -d @file -H "Authorization: Payment ..."`.

**When running as a cron/scheduled job WITHOUT a pre-approved SPT:** upload PDF → validate → create MPP order → decode challenge → create spend-request → **stop**. Report the approval URL and save state. Do not poll beyond ~2 min if user isn't actively present.
27. **Context field must be ≥100 chars.** The `--context` parameter on `spend-request create` enforces a 100-character minimum. Short contexts like "Abhinav postcard" return `VALIDATION_ERROR`. Pad with address, purpose, and batch context to clear the threshold. See `references/batch-orders.md` for examples.
28. **Old approved spend-requests can't pay new orders.** SPT tokens are scoped to specific challenges (challenge ID + externalId). An SPT approved for challenge A cannot pay order B even with same amount/currency/network_id. The server rejects with "Challenge <id> is invalid: challenge was not issued by this server." Challenges expire within minutes. Every new order needs a fresh spend-request approval.

   **Stale SPT + consumed upload token = dead end.** Common failure mode: order created → 402 with challenge A → SPT approved for challenge A → upload token consumed by 402 → rate limit or session ends before payment. Later: can't retry same order (token consumed, pitfall #24), can't create new order (SPT scoped to old challenge). Recovery requires: fresh upload token, fresh request_id, fresh 402, fresh spend-request approval. See `references/stale-spt-recovery.md` for the full error transcript and recovery flow.
29. **Omitting --requestApproval doesn't auto-approve.** `spend-request create` without `--requestApproval` still sets status to `pending_approval` — it just skips the push notification. The spend-request must still be manually approved in the Link app. There is no autonomous approval path.
30. **Base64 PDF payloads may hit 413 limit — compress first.** The MPP endpoint rejects request bodies > ~2MB with HTTP 413 "request entity too large" (PostalForm/Cloudflare). A base64-encoded 2-page Ghibli postcard PDF from PNG artwork is ~2.5MB. **Fix:** Convert artwork PNGs to JPEG (quality=85) before rendering the PDF with WeasyPrint. This shrinks PDFs from ~1.7MB to ~230KB, with base64 ≈ 310KB — well under the limit. Use this approach when the upload_token path is blocked. See `references/base64-jpeg-workaround.md` for the full pipeline.
31. **`link-cli mpp pay` always probes the URL first — can't skip.** Even without `--method POST` or `--data`, the command does a probe request to the URL, gets a 402 challenge, and tries to answer it with the SPT. If the probe returns a challenge different from the one the SPT was created for, payment fails with "UNKNOWN: Payment submission failed with status 422". There is no `--challenge` flag or skip-probe option. The command can ONLY succeed when the server reissues the SAME challenge the SPT was minted for — typically by replaying the exact same request (same request_id, same body) that generated the original 402. Combined with pitfall #24 (consumed token poisons the order), this makes `link-cli mpp pay` unusable for recovery of stale orders.

32. **Shell `base64 -w0` injects newlines that corrupt data URLs.** Running `base64 -w0 file.pdf` via `terminal()` or shell pipelines can produce newline characters in the output that corrupt the `data:application/pdf;base64,...` data URL. PostalForm rejects with `invalid_pdf: "Uploaded file is not a readable PDF"`. **Fix:** encode in pure Python:
    ```python
    import base64
    with open('card.pdf', 'rb') as f:
        b64_data = base64.b64encode(f.read()).decode('ascii')
    pdf_data_url = f"data:application/pdf;base64,{b64_data}"
    # Verify no newlines
    assert '\n' not in b64_data
    ```
    Same applies for image data URLs passed to OpenRouter image-gen models.

33. **MPP endpoint field names differ from validate endpoint and intuition.** Common mistakes on first attempt:
    - ❌ `"buyer": "user@example.com"` → ✓ `"buyer_name": "Jane Doe"` + `"buyer_email": "user@example.com"` (two separate fields)
    - ❌ `"sender_address_line1": "..."` (flat) → ✓ nested object: `"sender_address_type": "Manual"` + `"sender_address_manual": {"line1": "...", "line2": "...", "city": "...", "state": "NY", "zip": "..."}`
    - ❌ `"size": "4x6"` → ✓ `"postcard_size": "4x6"` + `"mailpiece_type": "postcard"`
    The validate endpoint's schema matches MPP — use it to verify your payload before submitting.

34. **Pre-approved SPT can fail with "Stripe PaymentIntent failed" even when mppx serialization is correct.** The SPT passes challenge verification (correct challenge ID, amount, network_id) but Stripe rejects the PaymentIntent creation on its end. This means the SPT itself is invalid — expired, already consumed, or the underlying payment method is unusable. Authentication header is structurally valid but the PaymentIntent creation fails server-side. **Recovery:** create a fresh `link-cli spend-request create` for the same order → get user approval → serialize new SPT with `mppx_gen.js` → retry with `curl -d @file -H "Authorization: Payment ..."`. Unlike upload-token-based orders, base64 payload orders can be safely replayed (no token to consume). The same `request_id` + body will generate a fresh 402 challenge that the new SPT can answer. See `references/spt-paymentintent-failed.md` for full error transcript.

35. **npm install mppx fails in /tmp with ERESOLVE conflict if package.json exists.** /tmp may contain a stale `package.json` (e.g., from vitest) with peer dependency conflicts that block `npm install mppx`. **Fix:** install in a clean subdirectory:
    ```bash
    mkdir -p /tmp/mppx_temp && cd /tmp/mppx_temp
    npm init -y --silent && npm install mppx --silent
    ```
    Then update `mppx_gen.js` to require from the correct path, or pass the path as an argument. The helper script at `scripts/mppx_gen.js` hardcodes `/tmp/node_modules/mppx` — always verify the install location before running it.
